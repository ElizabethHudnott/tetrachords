const SAMPLE_PATH = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/';
let instrument = 'dulcimer';

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ATTENUATION_BITS = 8;
const TIME_CONSTANTS = Math.log(1 << ATTENUATION_BITS);

const equaveInput = document.getElementById('equave');
const divisionsInput = document.getElementById('divisions');
const fourthInput = document.getElementById('fourth-interval');
const bigInput = document.getElementById('big-interval');
const midInput = document.getElementById('mid-interval');
const orderInput = document.getElementById('order');

const canvas = document.getElementById('number-line');
canvas.width = canvas.clientWidth;
const context2d = canvas.getContext('2d');

// 0 = big interval, 1 = mid interval 2 = small interval
const PERMUTATIONS = Object.freeze([
	[1, 2, 0],
	[1, 0, 2],
	[0, 1, 2],
	[0, 2, 1],
	[2, 0, 1],
	[2, 1, 0],
]);

let equave, numDivisions;
let fourthMin, fourthMax, fourth;
let bigIntervalMin, bigIntervalMax, bigInterval;
let midIntervalMin, midIntervalMax, midInterval;
let intervals;
let rootNote = 60, playbackRates = [1];
let releaseDuration = 0.7;

const audioContext = new AudioContext();
let samples = [];
const sourceNodes = [];
let noteNumbers = [];

const amps = [];
for (let i = 0; i < 7; i++) {
	const amp = new GainNode(audioContext);
	amp.connect(audioContext.destination);
	amps[i] = amp;
}

function stepsToRatio(steps) {
	return equave ** (steps / numDivisions);
}

function ratioToNoteNumber(ratio) {
	const steps = Math.ceil(Math.round(Math.log2(ratio) * 12 * 512) / 512) + rootNote;
	return Math.min(steps, 108);
}

function midiNoteToName(noteNumber) {
	const octave = Math.trunc(noteNumber / 12) - 1;
	const noteName = NOTE_NAMES[noteNumber % 12];
	return noteName + octave;
}

function ratioToSpeed(ratio, noteNumber) {
	return ratio / (2 ** ((noteNumber - rootNote) / 12));
}

function sampleURL(instrument, noteNumber) {
	return SAMPLE_PATH + instrument + '-mp3/' + midiNoteToName(noteNumber) + '.mp3';
}

function fetchSample(noteNumber) {
	const url = sampleURL(instrument, noteNumber);
	const promise = fetch(url, {cache: 'force-cache'})
	.then(response => {
		if (response.ok) {
			return response.arrayBuffer();
		} else {
			return Promise.reject(new Error('HTTP ' + response.status + ' ' + response.statusText));
		}
	})
	.then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
	.then(audioBuffer => [noteNumber, audioBuffer]);
	return promise;
}

function updateSamples() {
	const numIntervals = intervals.length;
	const newNotes = new Array(numIntervals + 1);
	const newRates = new Array(numIntervals + 1);
	newNotes[0] = rootNote;
	newRates[0] = 1;
	let stepAccumulator = 0;
	for (let i = 0; i < numIntervals; i++) {
		stepAccumulator += intervals[i];
		const ratio = stepsToRatio(stepAccumulator);
		const noteNumber = ratioToNoteNumber(ratio);
		newNotes[i + 1] = noteNumber;
		newRates[i + 1] = ratioToSpeed(ratio, noteNumber);
	}

	const promises = [];
	for (let note of newNotes) {
		if (samples[note] === undefined) {
			const promise = fetchSample(note)
			.then(data => samples[data[0]] = data[1]);
			promises.push(promise);
		}
	}
	const completed = Promise.all(promises)
	.then(() => {
		noteNumbers = newNotes;
		playbackRates = newRates;
	})
	.catch(error => Console.log(error));
	return completed;
}

function updateRootNote() {
	const note = parseInt(document.getElementById('root-note').value);
	const octave = parseInt(document.getElementById('root-octave').value);
	rootNote = note + 12 * octave + 69;
	updateSamples();
}

function instrumentChange(name) {
	instrument = name;
	samples = [];
	updateSamples();
}

function nextQuantum() {
	return audioContext.currentTime + 255 / audioContext.sampleRate;
}

/**
 * @param {number} scaleDegree One based index.
 */
function playNote(scaleDegree) {
	const midiNote = noteNumbers[scaleDegree - 1];
	const sample = samples[midiNote];
	if (sample === undefined) {
		return;
	}
	const newNode = new AudioBufferSourceNode(audioContext);
	newNode.buffer = sample;
	newNode.playbackRate.value = playbackRates[scaleDegree - 1];

	const amp = amps[scaleDegree - 1];
	newNode.connect(amp);

	const gain = amp.gain;
	const time = nextQuantum();
	gain.cancelScheduledValues(time);
	gain.setValueAtTime(1, time);
	newNode.start(time);

	const oldNode = sourceNodes[scaleDegree - 1];
	if (oldNode !== undefined) {
		oldNode.stop(time);
	}
	sourceNodes[scaleDegree - 1] = newNode;
}

function noteOff(scaleDegree) {
	const gain = amps[scaleDegree - 1].gain;
	const time = nextQuantum();
	gain.cancelScheduledValues(time);
	gain.setTargetAtTime(0, time, releaseDuration / TIME_CONSTANTS);
	const source = sourceNodes[scaleDegree - 1];
	source.stop(time + releaseDuration);
}

// Maps key codes to scale degrees.
const KEYMAP = new Map();
KEYMAP.set('KeyA', 1);
KEYMAP.set('KeyS', 2);
KEYMAP.set('KeyD', 3);
KEYMAP.set('KeyF', 4);
KEYMAP.set('KeyG', 5);

document.body.addEventListener('keydown', function (event) {
	if (event.repeat) {
		return;
	}
	const scaleDegree = KEYMAP.get(event.code);
	if (scaleDegree !== undefined) {
		audioContext.resume();
		playNote(scaleDegree);
	}
});

document.body.addEventListener('keyup', function (event) {
	const scaleDegree = KEYMAP.get(event.code);
	if (scaleDegree !== undefined) {
		noteOff(scaleDegree);
	}
});

function gcd(a, b) {
	while (b !== 0) {
		[a, b] = [b, a % b];
	}
	return a;
}

function findRatio(n, maxDivisor) {
	let bestNumerator = Math.round(n * maxDivisor);
	let bestDivisor = maxDivisor;
	let minError = Math.abs(Math.log2((bestNumerator / maxDivisor) / n));
	const minDivisor = Math.trunc(0.5 * maxDivisor) + 1;
	for (let i = maxDivisor - 1; i >= minDivisor; i--) {
		const numerator = Math.round(n * i);
		const error = Math.abs(Math.log2((numerator / i) / n));
		if (error <= minError) {
			bestNumerator = numerator;
			bestDivisor = i;
			minError = error;
		}
	}
	const commonDivisor = gcd(bestNumerator, bestDivisor);
	return [bestNumerator / commonDivisor, bestDivisor / commonDivisor];
}

function findRatios(multiples, minDenominator) {
	const numMultiples = multiples.length;
	let ratios = new Array(numMultiples);
	let maxFound = 0;
	for (let i = 0; i < numMultiples; i++) {
		const ratio = findRatio(multiples[i], minDenominator);
		ratios[i] = ratio;
		maxFound = Math.max(maxFound, ratio[0], ratio[1]);
	}

	let prevRatios, prevMaxFound;
	do {
		prevRatios = ratios;
		prevMaxFound = maxFound;
		maxFound = 0;
		ratios = new Array(numMultiples);
		for (let i = 0; i < numMultiples; i++) {
			const maxDenominator = Math.max(Math.trunc(prevMaxFound / multiples[i]), minDenominator);
			const ratio = findRatio(multiples[i], maxDenominator);
			ratios[i] = ratio;
			maxFound = Math.max(maxFound, ratio[0], ratio[1]);
		}
	} while (maxFound < prevMaxFound);
	return maxFound === prevMaxFound ? ratios : prevRatios;
}

function ratioText(ratio) {
	if (ratio[1] === 1) {
		return ratio[0].toString();
	} else {
		return ratio[0] + ' / ' + ratio[1];
	}
}

function drawNumberLine() {
	const numIntervals = intervals.length;
	const multiples = [1];
	let steps = 0;
	for (let i = 0; i < numIntervals; i++) {
		steps += intervals[i];
		multiples[i + 1] = equave ** (steps / numDivisions);
	}

	context2d.font = '1.25rem sans-serif';
	context2d.textBaseline = 'top';
	const textY = 0;
	context2d.clearRect(0, 0, canvas.width, canvas.height);

	const sensitivity = Math.ceil(1 / (equave ** (1 / numDivisions) - 1));
	const ratios = findRatios(multiples, sensitivity);
	let text = ratioText(ratios[0]);
	context2d.textAlign = 'left';
	context2d.fillText(text, 0, textY);
	let metrics = context2d.measureText(text);
	const left = Math.round(0.5 * metrics.width);
	text = ratioText(ratios[numIntervals]);
	context2d.textAlign = 'right';
	context2d.fillText(text, canvas.width, textY);
	metrics = context2d.measureText(text);
	const right = Math.round(canvas.width - 0.5 * metrics.width);
	const zoom = (right - left) / Math.log2(multiples[numIntervals]);

	context2d.textAlign = 'center';
	for (let i = 1; i < numIntervals; i++) {
		const x = left + Math.log2(multiples[i]) * zoom;
		text = ratioText(ratios[i]);
		context2d.fillText(text, x, textY);
	}
}

function previewInput() {
	equave = parseFloat(equaveInput.value);
	numDivisions = parseInt(divisionsInput.value);
	document.getElementById('divisions-readout').innerHTML = numDivisions;
	const stepMultiple = Math.log2(equave) * numDivisions;

	const fifth = Math.round(Math.log2(3 / 2) * stepMultiple);
	// Don't consider intervals smaller than a quarter tone.
	const smallestInterval = Math.max(Math.trunc(Math.log2(36 / 35) * stepMultiple), 1);

	let fourthProportion = 0;
	if (fourthInput.min !== '') {
		fourthMin = parseInt(fourthInput.min);
		fourthMax = parseInt(fourthInput.max);
		if (fourthMax > fourthMin) {
			fourthProportion = (parseInt(fourthInput.value) - fourthMin) / (fourthMax - fourthMin);
		}
	}
	fourthMin = Math.max(Math.round(Math.log2(4 / 3) * stepMultiple), 3);
	// 28:27 below the fifth
	fourthMax = Math.min(Math.round(Math.log2(81 / 56) * stepMultiple), fifth - smallestInterval);
	fourth = Math.round(fourthProportion * (fourthMax - fourthMin)) + fourthMin;
	document.getElementById('fourth-interval-readout').innerHTML = fourth;

	const augmentation = fourth - fourthMin;
	bigIntervalMin = Math.max(Math.ceil(fourth / 3), augmentation + smallestInterval);
	bigIntervalMax = Math.min(Math.round(Math.log2(81 / 64) * stepMultiple), fourth - 2 * smallestInterval);
	let bigProportion = 0;
	if (bigIntervalMax > bigIntervalMin) {
		if (bigInput.min === '') {
			// Default to a whole tone
			bigProportion = (Math.round(Math.log2(9 / 8) * stepMultiple) - bigIntervalMin) / (bigIntervalMax - bigIntervalMin);
		} else {
			const oldBigIntervalMin = parseInt(bigInput.min);
			const oldBigIntervalMax = parseInt(bigInput.max);
			if (oldBigIntervalMax > oldBigIntervalMin) {
				bigProportion = (parseInt(bigInput.value) - oldBigIntervalMin) / (oldBigIntervalMax - oldBigIntervalMin);
			}
		}
	}
	bigInterval = Math.round(bigProportion * (bigIntervalMax - bigIntervalMin)) + bigIntervalMin;
	document.getElementById('big-interval-readout').innerHTML = bigInterval;

	midIntervalMin = Math.ceil(0.5 * (fourth - bigInterval));
	midIntervalMax = Math.min(fourth - bigInterval - smallestInterval, bigInterval);
	let midProportion = 0;
	if (midInput.min !== '') {
		const oldMidIntervalMin = parseInt(midInput.min);
		const oldMidIntervalMax = parseInt(midInput.max);
		if (oldMidIntervalMax > oldMidIntervalMin) {
			midProportion = (parseInt(midInput.value) - oldMidIntervalMin) / (oldMidIntervalMax - oldMidIntervalMin);
		}
	}
	midInterval = Math.round(midProportion * (midIntervalMax - midIntervalMin)) + midIntervalMin;
	document.getElementById('mid-interval-readout').innerHTML = midInterval;

	const smallInterval = fourth - bigInterval - midInterval;
	document.getElementById('small-interval-readout').innerHTML = smallInterval;

	let sortedIntervals = [bigInterval, midInterval, smallInterval];
	let permutation = PERMUTATIONS[parseInt(orderInput.value)];
	intervals = [0, 0, 0];	// Add remaining elements after calling toString
	intervals[0] = sortedIntervals[permutation[0]];
	intervals[1] = sortedIntervals[permutation[1]];
	intervals[2] = sortedIntervals[permutation[2]];
	intervals[3] = fifth - fourth;
	document.getElementById('order-readout').innerHTML = intervals.toString();
	updateSamples();
	drawNumberLine();
}

function acceptInput() {
	fourthInput.min = fourthMin;
	fourthInput.max = fourthMax;
	fourthInput.value = fourth;

	bigInput.min = bigIntervalMin;
	bigInput.max = bigIntervalMax;
	bigInput.value = bigInterval;

	midInput.min = midIntervalMin;
	midInput.max = midIntervalMax;
	midInput.value = midInterval;
}

previewInput();
acceptInput();

{
	const inputs = [divisionsInput, fourthInput, bigInput, midInput, orderInput];
	for (let input of inputs) {
		input.addEventListener('input', previewInput);
		input.addEventListener('pointerup', acceptInput);
		input.addEventListener('keyup', acceptInput);
	}
}

document.getElementById('instrument').addEventListener('input', function (event) {
	instrumentChange(event.target.value);
});

document.getElementById('root-note').addEventListener('input', updateRootNote);
document.getElementById('root-octave').addEventListener('input', updateRootNote);
