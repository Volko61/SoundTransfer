import '@testing-library/jest-dom'

// Mock Web Audio API
global.AudioContext = jest.fn().mockImplementation(() => ({
  createAnalyser: jest.fn().mockReturnValue({
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData: jest.fn(),
    getFloatTimeDomainData: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
  createGain: jest.fn().mockReturnValue({
    gain: { value: 1 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
  createScriptProcessor: jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
    onaudioprocess: null,
  }),
  createMediaStreamSource: jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
  sampleRate: 48000,
  close: jest.fn().mockResolvedValue(undefined),
  destination: {},
}))

// Mock MediaDevices API
Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: jest.fn().mockReturnValue([
        {
          stop: jest.fn(),
          kind: 'audio',
        },
      ]),
    }),
  },
})

// Mock Canvas API
HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
  fillStyle: '',
  fillRect: jest.fn(),
  clearRect: jest.fn(),
  getImageData: jest.fn(),
  putImageData: jest.fn(),
  createImageData: jest.fn(),
  setTransform: jest.fn(),
  drawImage: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  scale: jest.fn(),
  rotate: jest.fn(),
  translate: jest.fn(),
  transform: jest.fn(),
  beginPath: jest.fn(),
  closePath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  bezierCurveTo: jest.fn(),
  quadraticCurveTo: jest.fn(),
  arc: jest.fn(),
  arcTo: jest.fn(),
  ellipse: jest.fn(),
  rect: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
  clip: jest.fn(),
  isPointInPath: jest.fn(),
  isPointInStroke: jest.fn(),
  measureText: jest.fn().mockReturnValue({ width: 0 }),
  canvas: document.createElement('canvas'),
})

HTMLCanvasElement.prototype.toBlob = jest.fn((callback) => {
  callback(new Blob(['fake-image-data'], { type: 'image/png' }))
})

// Suppress console errors in tests
const originalError = console.error
beforeAll(() => {
  console.error = jest.fn()
})

afterAll(() => {
  console.error = originalError
})
