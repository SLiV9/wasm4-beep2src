/** Filesystem library. */
let fs = require("fs");

/** Command line arguments. */
var arguments = process.argv.slice(2);

/** Expected arguments to be received. */
var expectedArguments = 3;

// Display usage when not enough arguments are passed...
if(arguments.length < expectedArguments) {
  console.log(`
===========================================================
BeatBox to WASM-4 Importer
Version 0.0.0.1
===========================================================
Usage:
  * node beep2fn {@path} {@resname} {@incdriver}

@path: path to BeepBox's JSON file.
@resname: Resource name (that is, the variable).
@incdriver: use "true" to include the driver.
===========================================================
Notes:
  * Scale must be "expert", key must be "C".
  * Only the very first instrument will be converted.
  * It only works with one track.
  * Each track has support for 32 notes.
  * This may or may not be updated (it's just a PoC).
  * Only Rust is supported.
===========================================================
BeepBox:
  * Official website: https://www.beepbox.co/2_3/
  * Only version 2.3 is supported.
===========================================================
`);
  return;
}

/** BeepBox music file. */
let file = fs.readFileSync(arguments[0].toString(), "utf8");

/** BeepBox data object parsed from JSON. */
let data = JSON.parse(file);

/** Templates in use. */
let templates = {
  driver: fs.readFileSync("./templates/driver_fn.rs", "utf8")
};

// Final result.
let result = "";

// Include driver (optional)...
if(arguments[2].toString().trim().toLowerCase() === "true") {
  result += templates.driver;
}

/**
 * BeepBox settings.
 * Some important notes:
 *
 * ~ Tones SHOULD be in scale "expert" and key "C".
 * ~ The "introBars" and "loopBars" determine music duration. In the context
 *   of the original file, they represent offsets from the beginning and the
 *   end of the music.
 */
let BeepBox = {
  /** Musical note indexes, sorted by pitch. */
  notes: [
    36, 37, 38, 39, 40, 41, 42, 43, 44,
    45, 46, 47, 48, 49, 50, 51, 52, 53,
    54, 55, 56, 57, 58, 59, 60, 61, 62,
    63, 64, 65, 66, 67, 68, 69, 70, 71,
    72
  ],
  /** Musical note names. */
  names: [
     "C0", "D+0",  "D0", "E+0",  "E0",  "F0", "F#0",  "G0", "A+0",
     "A0", "B+0",  "B0",  "C1", "D+1",  "D1", "E+1",  "E1",  "F1",
    "F#1",  "G1", "A+1",  "A1", "B+1",  "B1",  "C2", "D+2",  "D2",
    "E+2",  "E2",  "F2", "F#2",  "G2", "A+2",  "A2", "B+2",  "B2",
     "C3"
  ],
  /** WASM-4 equivalent of musical tones, using the same musical notes. */
  tones: [
     130,  140,  150,  160,  170,  180,  190,  200,  210,
     220,  230,  250,  260,  280,  290,  310,  330,  350,
     370,  390,  410,  440,  460,  490,  520,  550,  600,
     620,  660,  700,  750,  780,  840,  880,  940,  980,
    1000
  ],
  /** Waves (instruments) available for use. */
  waves: [
    "triangle",
    "square",
    "pulse wide",
    "pulse narrow",
    "sawtooth"
  ],
  /** WASM-4 equivalent flags. */
  wave_flags: [
    `TONE_TRIANGLE | TONE_MODE1`,
    `TONE_PULSE2 | TONE_MODE3`,
    `TONE_PULSE2 | TONE_MODE4`,
    `TONE_PULSE2 | TONE_MODE2`,
    `TONE_PULSE2 | TONE_MODE1`,
  ]
};

// Resource identifier
let identifier = arguments[1].toString().trim();

// Number of BeepBox ticks per minute.
let ticksPerMinute = data.ticksPerBeat * data.beatsPerMinute;

// Time duration of a BeepBox tick in WASM4 ticks (60 ticks per second).
let tickDuration = Math.round(3600 / ticksPerMinute);

// Time duration of a BeepBox pattern.
let patternDuration = data.beatsPerBar * data.ticksPerBeat * tickDuration;

result += `\n/// Soundtrack: *${identifier}*\n`;

// Output a function for each channel.
for (let [channelOffset, channel] of data.channels.entries()) {
  // Track number.
  let track = channelOffset + 1;

  /** Wave name in use. */
  let instrument = channel.instruments[0];
  // Get instrument index...
  let instrumentOffset = BeepBox.waves.indexOf(instrument.wave);
  // Revert back to zero if it doesn't exist or it's not supported...
  if(instrumentOffset < 0) {
    instrumentOffset = 0;
  }
  // Get instrument flags.
  let instrumentFlags = BeepBox.wave_flags[instrumentOffset];

  let usedPatterns = channel.patterns.map((p, i) => [p, i + 1]).filter(([p, n]) => p.notes.length > 0);

  if (usedPatterns.length == 0) {
    continue;
  }

  let sequence = [];
  for (let b = 0; b < data.loopBars; b += 1) {
    sequence.push(channel.sequence[data.introBars + b]);
  }

  // Code to play this track
  result += `pub fn play_${identifier}`;
  if (data.channels.length > 1) {
    result += `_track_${track}`;
  }
  result += `(t: usize, volume: u32) {\n`;
  if (sequence.length > 0) {
    result += `\tlet sequence = [${sequence}];\n`;
    result += `\tmatch sequence[(t / ${patternDuration}) % sequence.len()] {\n`;
    for (let [p, n] of usedPatterns) {
      result += `\t\t${n} => play_${identifier}_track_${track}_pattern_${n}(t, volume),\n`;
    }
    result += `\t\t_ => (),\n`;
    result += `\t}\n`;
  }
  result += `}\n\n`;

  for (let [p, n] of usedPatterns) {
    result += `fn play_${identifier}_track_${track}_pattern_${n}`
    result += `(t: usize, volume: u32) {\n`;
    result += `\tlet tt = t % ${patternDuration};\n`;
    result += `\tmatch tt {\n`;
    for (let note of p.notes) {
      let tStart = note.points[0].tick * tickDuration;
      let tEnd = note.points[1].tick * tickDuration;
      let pitches = [...note.pitches];
      pitches.sort();
      for (let pitch of pitches) {
        result += `\t\t${tStart} => {\n`;
        let pitchOffset = BeepBox.notes.indexOf(pitch);
        if (pitchOffset < 0) {
          pitchOffset = 18;
        }
        let freq = BeepBox.tones[pitchOffset];
        let release = tEnd - tStart;
        result += `\t\t\ttone(${freq}, ${release} << 8, volume`;
        let relativeVolume = note.points[0].volume * instrument.volume / 100;
        if (relativeVolume < 100) {
          result += ` * ${relativeVolume} / 100`;
        }
        result += `, ${instrumentFlags});\n`;
        result += `\t\t}\n`;
        tStart += 1;
      }
    }
    result += `\t\t_ => (),\n`;
    result += `\t}\n`;
    result += `}\n\n`;
  }
}

// Result.
console.log(result);
