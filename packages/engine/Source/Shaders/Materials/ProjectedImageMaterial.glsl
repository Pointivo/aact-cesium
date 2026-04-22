uniform sampler2D image;
uniform vec4 color;
uniform vec2 uvOffset;
uniform vec2 uvScale;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);

    // Transform UVs from full-image space to loaded-region space
    vec2 regionUV = (materialInput.st - uvOffset) / uvScale;

    // Discard pixels outside the loaded region
    if (regionUV.s < 0.0 || regionUV.s > 1.0 || regionUV.t < 0.0 || regionUV.t > 1.0) {
        material.diffuse = vec3(0.0);
        material.alpha = 0.0;
        return material;
    }

    vec4 texColor = texture(image, regionUV);
    texColor = czm_gammaCorrect(texColor);
    material.diffuse = texColor.rgb * color.rgb;
    material.alpha = texColor.a * color.a;

    return material;
}
