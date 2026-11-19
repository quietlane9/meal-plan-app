/**
 * 업로드한 이미지를 긴 변 1280px, JPEG 품질 0.8로 줄여 base64로 돌려준다.
 */
async function resizeImageToJpegBase64(file, maxSide = 1280, quality = 0.8) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const { width, height } = fitSize(img.width, img.height, maxSide);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);

  const resizedDataUrl = canvas.toDataURL('image/jpeg', quality);
  return resizedDataUrl.split(',')[1];
}

function fitSize(width, height, maxSide) {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const scale = maxSide / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
