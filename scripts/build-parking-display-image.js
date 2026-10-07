// 元の図面を埋め込み、台数の表記だけを重ねた表示用SVGを作る。
function buildDisplayImage(spec, sourceImage) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
  <title>${spec.displayCaption.text}</title>
  <image width="${spec.width}" height="${spec.height}" href="data:image/jpeg;base64,${sourceImage.toString('base64')}"/>
  <rect x="0" y="0" width="${spec.displayCaption.width}" height="${spec.displayCaption.height}" fill="white"/>
  <text x="10" y="24" font-family="Yu Mincho, MS Mincho, serif" font-size="24" fill="black">${spec.displayCaption.text}</text>
</svg>\n`;
}

module.exports = { buildDisplayImage };
