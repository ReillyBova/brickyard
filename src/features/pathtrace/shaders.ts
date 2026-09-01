/**
 * GLSL sources for the path tracer's three passes: TRACE (BVH path trace + temporal
 * reprojection into an accumulation buffer), and PRESENT (upscale + tonemap to the canvas).
 *
 * Ray/BVH intersection comes from `three-mesh-bvh`'s public GPU API (`shaderStructs` +
 * `shaderIntersectFunction`, concatenated in below) — that part is solved and well tested, and
 * this module only adds the shading, sampling and reprojection around it.
 *
 * Every fragment shader here compiles under WebGL2/GLSL ES 300 (three.js always compiles
 * `ShaderMaterial` that way; `texelFetch`/`usampler2D` from the BVH chunks need it) but is
 * written in `ShaderMaterial`'s GLSL1-flavoured surface (`attribute`, `varying`, `texture2D`,
 * `gl_FragColor`) rather than raw `in`/`out`, because three.js auto-shims that surface onto the
 * real ES300 profile it always compiles to — no manual `layout(location=0) out ...` needed.
 */

import { shaderStructs, shaderIntersectFunction } from 'three-mesh-bvh';

import { MAX_MATERIALS } from './sceneBake.ts';

/** Standard `FullScreenQuad` vertex shader — identical across every pass. */
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RNG_AND_SAMPLING = /* glsl */ `
uint rngState;
uint pcgHash( uint v ) {
  v = v * 747796405u + 2891336453u;
  uint w = ( ( v >> ( ( v >> 28u ) + 4u ) ) ^ v ) * 277803737u;
  return ( w >> 22u ) ^ w;
}
float rand() {
  rngState = pcgHash( rngState );
  return float( rngState ) / 4294967296.0;
}
void seedRng( vec2 pixel, int frame, int sampleIndex ) {
  rngState = uint( pixel.x ) * 1973u + uint( pixel.y ) * 9277u
    + uint( frame ) * 26699u + uint( sampleIndex ) * 40503u + 1u;
  rngState = pcgHash( rngState );
}
vec3 cosineSampleHemisphere( vec3 n ) {
  float r1 = rand();
  float r2 = rand();
  float phi = 6.28318530718 * r1;
  float cosTheta = sqrt( 1.0 - r2 );
  float sinTheta = sqrt( r2 );
  vec3 up = abs( n.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 tangent = normalize( cross( up, n ) );
  vec3 bitangent = cross( n, tangent );
  return normalize( tangent * cos( phi ) * sinTheta + bitangent * sin( phi ) * sinTheta + n * cosTheta );
}
`;

const MATERIAL_BANK = /* glsl */ `
#define MAX_MATERIALS ${MAX_MATERIALS}
// [0]=color.rgb, roughness | [1]=metalness, clearcoat, clearcoatRoughness, transmission
// [2]=attenuationColor.rgb, ior | [3]=sheenColor.rgb, sheen | [4]=attenuationDistance, opacity
uniform vec4 uMatA[ MAX_MATERIALS ];
uniform vec4 uMatB[ MAX_MATERIALS ];
uniform vec4 uMatC[ MAX_MATERIALS ];
uniform vec4 uMatD[ MAX_MATERIALS ];
uniform vec4 uMatE[ MAX_MATERIALS ];
`;

/**
 * Path traces one pixel: primary ray from the camera, `uSpp` samples, `MAX_BOUNCES` bounces
 * each with next-event sun sampling, reprojected onto the accumulation buffer this frame's
 * primary hit warps to in the *previous* frame (full view-projection matrix, not a restricted
 * camera model — `OrbitControls` also pans and dollies, not just orbits).
 */
export const TRACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;

${shaderStructs}
${shaderIntersectFunction}
${RNG_AND_SAMPLING}
${MATERIAL_BANK}

#define MAX_BOUNCES 3
#define EPS 0.01

uniform BVH bvh;
uniform sampler2D uNormalAttr;
uniform usampler2D uMaterialIndexAttr;

uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform mat4 uPrevViewProj;
uniform sampler2D uPrevColor;
uniform vec2 uRegion;
uniform vec2 uPrevRegion;
uniform vec2 uFull;

uniform int uFrame;
uniform int uSpp;
uniform bool uMoving;
uniform float uHistScale;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;

varying vec2 vUv;

// ndcToCameraRay comes from three-mesh-bvh's common_functions chunk, concatenated in above
// via shaderIntersectFunction — do not redefine it here.

// A small cone around the sun direction, jittered per sample for soft shadows.
vec3 jitteredSunDirection() {
  float a1 = rand();
  float a2 = rand();
  float radius = 0.045 * sqrt( a1 );
  float theta = 6.28318530718 * a2;
  vec3 up = abs( uSunDirection.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 tangent = normalize( cross( up, uSunDirection ) );
  vec3 bitangent = cross( uSunDirection, tangent );
  return normalize( uSunDirection + radius * ( tangent * cos( theta ) + bitangent * sin( theta ) ) );
}

bool traceScene(
  vec3 origin, vec3 direction,
  out uvec4 faceIndices, out vec3 barycoord, out float dist
) {
  vec3 faceNormal;
  float side;
  faceIndices = uvec4( 0u );
  barycoord = vec3( 0.0 );
  dist = 0.0;
  return bvhIntersectFirstHit( bvh, origin, direction, faceIndices, faceNormal, barycoord, side, dist );
}

void sampleOnePath( vec3 origin, vec3 direction, out vec3 radiance, out vec3 primaryWorldPos, out bool primaryHit ) {
  vec3 throughput = vec3( 1.0 );
  radiance = vec3( 0.0 );
  primaryHit = false;

  // Beer-Lambert state carried from the bounce that entered a transmissive volume to the
  // one that finds its far side. insideMedium tracks whether the ray currently in flight
  // started inside a transparent part; mediumSigma is its per-channel absorption
  // coefficient (-log(attenuationColor) / attenuationDistance, computed once on entry).
  // Rays here never refract (thin-surface direction pass-through), so "the next hit" is
  // the far side of the volume, and dist to it is the true path length to attenuate over.
  bool insideMedium = false;
  vec3 mediumSigma = vec3( 0.0 );

  for ( int bounce = 0; bounce < MAX_BOUNCES; bounce ++ ) {

    uvec4 faceIndices;
    vec3 barycoord;
    float dist;
    bool hit = traceScene( origin, direction, faceIndices, barycoord, dist );

    if ( ! hit ) {
      radiance += throughput * uAmbientColor;
      break;
    }

    if ( insideMedium ) {
      throughput *= exp( - mediumSigma * dist );
      insideMedium = false;
    }

    vec3 hitPoint = origin + direction * dist;
    if ( bounce == 0 ) {
      primaryWorldPos = hitPoint;
      primaryHit = true;
    }

    vec3 normal = normalize( textureSampleBarycoord( uNormalAttr, barycoord, faceIndices.xyz ).xyz );
    if ( dot( normal, direction ) > 0.0 ) normal = - normal;

    int matIndex = int( uTexelFetch1D( uMaterialIndexAttr, faceIndices.x ).x );
    vec3 color = uMatA[ matIndex ].rgb;
    float roughness = max( uMatA[ matIndex ].a, 0.03 );
    float metalness = uMatB[ matIndex ].x;
    float clearcoat = uMatB[ matIndex ].y;
    float transmission = uMatB[ matIndex ].w;
    vec3 attenuationColor = uMatC[ matIndex ].rgb;
    float attenuationDistance = max( uMatE[ matIndex ].x, 0.001 );

    // ---- next-event estimation: one shadow ray toward the (jittered) sun ----
    float NdotV = max( dot( normal, - direction ), 0.001 );
    float fresnel = 0.04 + 0.96 * pow( 1.0 - NdotV, 5.0 );
    vec3 sunDir = jitteredSunDirection();
    float NdotL = dot( normal, sunDir );
    if ( NdotL > 0.0 && transmission < 0.5 ) {
      uvec4 shadowFace;
      vec3 shadowBary;
      float shadowDist;
      bool blocked = traceScene( hitPoint + normal * EPS, sunDir, shadowFace, shadowBary, shadowDist );
      if ( ! blocked ) {
        vec3 diffuseTerm = color * ( 1.0 - metalness ) * ( 1.0 - fresnel ) * NdotL;
        vec3 halfVec = normalize( sunDir - direction );
        float specAngle = max( dot( normal, halfVec ), 0.0 );
        float shininess = mix( 8.0, 220.0, 1.0 - roughness );
        vec3 specTint = mix( vec3( fresnel + clearcoat * 0.5 ), color, metalness );
        vec3 specularTerm = specTint * pow( specAngle, shininess ) * NdotL;
        radiance += throughput * uSunColor * ( diffuseTerm + specularTerm );
      }
    }

    // ---- choose the next bounce direction stochastically ----
    float pTransmit = transmission;
    float pSpecular = ( 1.0 - pTransmit ) * mix( fresnel, 1.0, metalness );
    float pDiffuse = max( 1.0 - pTransmit - pSpecular, 0.0 );
    float r = rand();

    if ( r < pTransmit ) {
      // Enter the volume: only the importance-sampling weight applies here (probability
      // compensation for having stochastically chosen "transmit" out of the three bounce
      // types) — the actual absorbed colour is applied above, once the far-side distance is
      // known. No refraction bend: a thin-surface direction pass-through, tinted by real
      // Beer-Lambert absorption rather than by geometry-independent surface tint.
      throughput /= max( pTransmit, 0.05 );
      insideMedium = true;
      mediumSigma = - log( max( attenuationColor, vec3( 0.01 ) ) ) / attenuationDistance;
      origin = hitPoint + direction * EPS;
    } else if ( r < pTransmit + pSpecular ) {
      vec3 reflectDir = reflect( direction, normal );
      vec3 scattered = cosineSampleHemisphere( reflectDir );
      direction = normalize( mix( reflectDir, scattered, roughness * roughness ) );
      vec3 specColor = mix( vec3( 1.0 ), color, metalness );
      throughput *= specColor / max( pSpecular, 0.05 );
      origin = hitPoint + normal * EPS;
    } else {
      direction = cosineSampleHemisphere( normal );
      throughput *= color / max( pDiffuse, 0.05 );
      origin = hitPoint + normal * EPS;
    }

    // Path is spent; nothing further can contribute meaningfully.
    if ( max( throughput.r, max( throughput.g, throughput.b ) ) < 0.02 ) break;
  }
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rayOrigin, rayDirection;
  ndcToCameraRay( ndc, uCameraWorld, uInvProjection, rayOrigin, rayDirection );
  rayDirection = normalize( rayDirection );

  vec3 accumulated = vec3( 0.0 );
  vec3 primaryWorldPos = rayOrigin + rayDirection * 100000.0;
  bool primaryHit = false;

  for ( int s = 0; s < uSpp; s ++ ) {
    seedRng( gl_FragCoord.xy, uFrame, s );
    vec3 sampleRadiance;
    vec3 sampleWorldPos;
    bool sampleHit;
    // Sub-pixel jitter for antialiasing, in NDC.
    vec2 jitter = ( vec2( rand(), rand() ) - 0.5 ) / uRegion;
    vec3 jitteredOrigin, jitteredDirection;
    ndcToCameraRay( ndc + jitter * 2.0, uCameraWorld, uInvProjection, jitteredOrigin, jitteredDirection );
    jitteredDirection = normalize( jitteredDirection );
    sampleOnePath( jitteredOrigin, jitteredDirection, sampleRadiance, sampleWorldPos, sampleHit );
    accumulated += sampleRadiance;
    if ( s == 0 ) {
      primaryWorldPos = sampleWorldPos;
      primaryHit = sampleHit;
    }
  }
  accumulated /= float( uSpp );

  vec4 prevClip = uPrevViewProj * vec4( primaryWorldPos, 1.0 );
  vec2 prevUvFull = ( prevClip.xy / prevClip.w ) * 0.5 + 0.5;
  bool validHistory = primaryHit && prevClip.w > 0.0
    && all( greaterThanEqual( prevUvFull, vec2( 0.0 ) ) ) && all( lessThanEqual( prevUvFull, vec2( 1.0 ) ) );

  vec4 prevSample = vec4( 0.0 );
  if ( validHistory ) {
    vec2 prevUv = prevUvFull * ( uPrevRegion / uFull );
    prevSample = texture2D( uPrevColor, prevUv );
  }

  float prevWeight = validHistory ? prevSample.a * uHistScale : 0.0;
  if ( uMoving ) prevWeight = min( prevWeight, 2.0 );
  float newWeight = min( prevWeight + 1.0, 64.0 );
  vec3 blended = prevWeight > 0.0 ? mix( prevSample.rgb, accumulated, 1.0 / newWeight ) : accumulated;

  gl_FragColor = vec4( blended, newWeight );
}
`;

/** Upscales the trace target's active sub-rect (`uRegion` of `uFull`) to the canvas, tonemapped. */
export const PRESENT_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uTex;
uniform vec2 uRegion;
uniform vec2 uFull;
uniform float uExposure;

varying vec2 vUv;

vec3 acesFilm( vec3 x ) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
}

void main() {
  vec2 uv = vUv * ( uRegion / uFull );
  vec3 color = texture2D( uTex, uv ).rgb * uExposure;
  color = acesFilm( color );
  color = pow( color, vec3( 1.0 / 2.2 ) );
  gl_FragColor = vec4( color, 1.0 );
}
`;
