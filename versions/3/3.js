const imgEmitBtn = document.getElementById("imgEmitBtn")
const imgEmitInput = document.getElementById("imgEmitInput")

const imgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

const imgCanvasPreview = document.getElementById('imgCanvasPreview');
const imgCanvaCtx = imgCanvasPreview.getContext('2d');

let imgWidth = 320
let imgHeight = 240

// ===================== EMITTER FUNCTIONS =====================

const imgImg = new Image()

imgEmitInput.addEventListener("change", () => {
    if (imgEmitInput.files.length !== 1) {
        console.log("Select only one file")
        return
    }
    let file = imgEmitInput.files[0]
    imgImg.onload = () => {
        imgCanvasPreview.width = imgWidth;
        imgCanvasPreview.height = imgHeight;
        imgCanvaCtx.fillStyle = "black"
        imgCanvaCtx.fillRect(0, 0, imgWidth, imgHeight)

        const scale = Math.min(imgWidth / imgImg.width, imgHeight / imgImg.height)
        const x = (imgWidth / 2) - (imgImg.width / 2) * scale
        const y = (imgHeight / 2) - (imgImg.height / 2) * scale

        imgCanvaCtx.drawImage(imgImg, x, y, imgImg.width * scale, imgImg.height * scale)
    }
    imgImg.src = URL.createObjectURL(file)
    imgEmitBtn.disabled = false
})

imgEmitBtn.addEventListener("click", () => {
    if (imgAudioCtx.state === 'suspended') {
        imgAudioCtx.resume();
    }

    encodeImage(imgCanvaCtx.getImageData(0, 0, imgWidth, imgHeight).data)
})

function encodeImage(imageData) {
    const osc = imgAudioCtx.createOscillator();
    const gain = imgAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(imgAudioCtx.destination);

    let time = imgAudioCtx.currentTime + 0.2;
    osc.start(time);

    for (let y = 0; y < imgHeight; y++) {
        const isEven = (y % 2 === 0)

        // SYNC (sync pulse 9ms@1200Hz)
        osc.frequency.setValueAtTime(1200, time)
        time += 0.009

        // SYNC Porch 3ms@1500Hz
        osc.frequency.setValueAtTime(1500, time)
        time += 0.003

        // Y SCAN (88ms for 320px)
        const yPixelDuration = 0.088 / imgWidth
        for (let x = 0; x < imgWidth; x++) {
            const pixel = getPixelRGB(imageData, x, y)
            const yVal = rgbToY(pixel.r, pixel.g, pixel.b)
            osc.frequency.linearRampToValueAtTime(pixelToFreq(yVal), time)
            time += yPixelDuration
        }

        // SEPARATOR Even = 1500Hz, Odd = 2300Hz for 4.5ms
        const separatorFreq = isEven ? 1500 : 2300
        osc.frequency.setValueAtTime(separatorFreq, time)
        time += 0.0045

        // PORCH 1.5ms @1900Hz
        osc.frequency.setValueAtTime(1900, time)
        time += 0.0015

        // Color Scan (R-Y or B-Y) 44ms for 320px
        const cPixelDuration = 0.044 / imgWidth
        for (let x = 0; x < imgWidth; x++) {
            const pixel = getPixelRGB(imageData, x, y)
            let cVal;
            if (isEven) {
                cVal = rgbToCr(pixel.r, pixel.g, pixel.b)
            } else {
                cVal = rgbToCb(pixel.r, pixel.g, pixel.b)
            }
            osc.frequency.linearRampToValueAtTime(pixelToFreq(cVal), time)
            time += cPixelDuration
        }
    }
    osc.stop(time)
    return time
}

function getPixelRGB(data, x, y) {
    const index = (y * imgWidth + x) * 4;
    return {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
    };
}

function rgbToY(r, g, b) { return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255; }
function rgbToCb(r, g, b) { return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255; }
function rgbToCr(r, g, b) { return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255; }

function pixelToFreq(pixel_value) {
    return 1500 + (pixel_value * ((2300 - 1500) / 255))
}