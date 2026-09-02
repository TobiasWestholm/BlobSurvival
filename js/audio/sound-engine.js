// Sound engine for handling game audio effects and music

const SoundEngine = {
    PRIORITY: {
        LOW: 0,
        MEDIUM: 1,
        HIGH: 2,
        CRITICAL: 3
    },
    ctx: null,
    masterGain: null,
    duckingGain: null,
    sfxBus: null,
    musicBus: null,
    musicMidEq: null,
    musicHighEq: null,
    musicFilter: null,
    musicReverbConvolverStart: null,
    musicReverbConvolverEnd: null,
    musicReverbConvolverVictory: null,
    musicWetGainStart: null,
    musicWetGainEnd: null,
    musicWetGainVictory: null,
    musicDryGain: null,
    uiBus: null,
    compressor: null,
    fxReverbConvolverStart: null,
    fxReverbConvolverEnd: null,
    fxReverbConvolverVictory: null,
    fxWetGainStart: null,
    fxWetGainEnd: null,
    fxWetGainVictory: null,
    reverbDryGain: null,
    noiseBuffer: null,
    laserBuffer: null,
    dashBuffer: null,
    meleeBuffer: null,
    flameBuffer: null,
    missileBuffer: null,
    damageBuffer: null,
    bossWarningBuffer: null,
    
    // Background Soundtrack Synth Preset & Sequence (Opus-style progressive sawtooth)
    SYNTH_SOUND_PRESET: [, 0, 110, 0.01, 0.33, 0.4, 2, , , , , , , 0.2, , , , , , 0.18],
    
    // Soundtrack Engine State & Progression Milestones:
    // Speed ramps 10 BPM -> 140 BPM across 24 min (1 - (1-p)^3 cubic curve, staying at 140 BPM for t > 24m)
    // Filter sweeps 400 Hz -> 20 kHz from minute 0 to 24 (p^2.2 power curve)
    SPEED_MAX_MS: 24 * 60 * 1000,       // Minute 24 (1,440,000 ms)
    FILTER_DURATION_MS: 24 * 60 * 1000, // Minute 24 (1,440,000 ms)
    REVERB_DURATION_MS: 24 * 60 * 1000, // Minute 24 (1,440,000 ms)

    getSpeedProgress() {
        const p = Math.max(0.0, Math.min(1.0, (this.musicElapsedMs || 0) / this.SPEED_MAX_MS));
        return 1 - Math.pow(1 - p, 3);
    },
    getFilterProgress() {
        return Math.max(0.0, Math.min(1.0, (this.musicElapsedMs || 0) / this.FILTER_DURATION_MS));
    },
    getFilterCutoff() {
        const fp = this.getFilterProgress();
        const shapedProgress = Math.pow(fp, 2.1); // k = 2.1 stays warm early and accelerates towards late game
        return Math.min(20000, 400 * Math.pow(20000 / 400, shapedProgress));
    },
    getReverbProgress() {
        return Math.max(0.0, Math.min(1.0, (this.musicElapsedMs || 0) / this.REVERB_DURATION_MS));
    },

    isMusicMuted: false,
    isMusicPlaying: false,
    isMusicPaused: false,
    isMuffled: false,
    isVictoryRamping: false,
    victoryStartTime: 0,
    victoryDuration: 3000,
    victoryStartBpm: 10,
    victoryStartWet: 0.68,
    musicMode: 'menu', // 'menu' | 'gameplay'
    tempoFactor: 1.0,
    targetTempoFactor: 1.0,
    tempoTransitionStartTime: 0,
    tempoTransitionDuration: 0,
    tempoTransitionStartFactor: 1.0,
    musicElapsedMs: 0,
    musicLastTickTime: 0,
    musicStep: 0,
    musicNextNoteTime: 0,
    musicNoteCache: {},

    MELODY_NOTES: {
        'C0': 65.41,
        'D0': 73.42,
        'F0': 87.31,
        'G0': 98.00,
        'A0': 110.00,
        'B0': 123.47,
        'C1': 130.81,
        'D1': 146.83,
        'E1': 164.81,
        'F1': 174.61,
        'G1': 196.00,
        'A1': 220.00,
        'B1': 246.94,
        'C2': 261.63,
        'D2': 293.66,
        'E2': 329.63
    },

    LOADING_MELODY_SEQUENCE: [
        'A1', '-', '-', 'A1',
        '-', '-', '-', '-',
        '-', '-', '-', '-',
        '-', '-', 'E1', '-',
        'C1', '-', '-', '-',
        '-', '-', '-', '-',
        '-', '-', '-', '-',
        '-', '-', '-', '-',
        'B1', '-', '-', 'B1',
        '-', '-', '-', '-',
        '-', '-', '-', '-',
        '-', '-', 'G1', '-',
        'E1', '-', '-', '-',
        '-', '-', '-', '-',
        'D1', '-', '-', '-',
        '-', '-', '-', '-'
    ],

    MELODY_SEQUENCE: [
        // 4x: A0, A1, C1, E1
        'A0', 'A1', 'C1', 'E1',
        'A0', 'A1', 'C1', 'E1',
        'A0', 'A1', 'C1', 'E1',
        'A0', 'A1', 'C1', 'E1',

        // 4x: A0, B1, C1, E1
        'A0', 'B1', 'C1', 'E1',
        'A0', 'B1', 'C1', 'E1',
        'A0', 'B1', 'C1', 'E1',
        'A0', 'B1', 'C1', 'E1',

        // 4x: A0, C2, C1, E1
        'A0', 'C2', 'C1', 'E1',
        'A0', 'C2', 'C1', 'E1',
        'A0', 'C2', 'C1', 'E1',
        'A0', 'C2', 'C1', 'E1',

        // 4x: A0, D2, C1, E1
        'A0', 'D2', 'C1', 'E1',
        'A0', 'D2', 'C1', 'E1',
        'A0', 'D2', 'C1', 'E1',
        'A0', 'D2', 'C1', 'E1',

        // 4x: G0, F2, B0, D1
        'G0', 'E2', 'B0', 'D1',
        'G0', 'E2', 'B0', 'D1',
        'G0', 'E2', 'B0', 'D1',
        'G0', 'E2', 'B0', 'D1',

        // 4x: G0, D2, B0, D1
        'G0', 'D2', 'B0', 'D1',
        'G0', 'D2', 'B0', 'D1',
        'G0', 'D2', 'B0', 'D1',
        'G0', 'D2', 'B0', 'D1',

        // 4x: G0, C2, B0, D1
        'G0', 'C2', 'B0', 'D1',
        'G0', 'C2', 'B0', 'D1',
        'G0', 'C2', 'B0', 'D1',
        'G0', 'C2', 'B0', 'D1',

        // 4x: G0, B2, B0, D1
        'G0', 'B1', 'B0', 'D1',
        'G0', 'B1', 'B0', 'D1',
        'G0', 'B1', 'B0', 'D1',
        'G0', 'B1', 'B0', 'D1',

        // 4x: F0, A1, A0, C1
        'F0', 'A1', 'A0', 'C1',
        'F0', 'A1', 'A0', 'C1',
        'F0', 'A1', 'A0', 'C1',
        'F0', 'A1', 'A0', 'C1',

        // 4x: F0, B1, A0, C1
        'F0', 'B1', 'A0', 'C1',
        'F0', 'B1', 'A0', 'C1',
        'F0', 'B1', 'A0', 'C1',
        'F0', 'B1', 'A0', 'C1',

        // 4x: F0, C1, A0, C1
        'F0', 'C2', 'A0', 'C1',
        'F0', 'C2', 'A0', 'C1',
        'F0', 'C2', 'A0', 'C1',
        'F0', 'C2', 'A0', 'C1',

        // 4x: F0, D1, A0, C1
        'F0', 'D2', 'A0', 'C1',
        'F0', 'D2', 'A0', 'C1',
        'F0', 'D2', 'A0', 'C1',
        'F0', 'D2', 'F0', 'A0',

        // 4x: D0, C2, F0, A0
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',

        // 4x: D0, E2, F0, A0
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',
        'D0', 'C2', 'F0', 'A0',

        // 4x: D0, D2, F0, A0
        'D0', 'B1', 'F0', 'A0',
        'D0', 'B1', 'F0', 'A0',
        'D0', 'B1', 'F0', 'A0',
        'D0', 'B1', 'F0', 'A0',

        // 4x: D0, D2, F0, A0
        'D0', 'B1', 'A0', 'D1',
        'D0', 'B1', 'A0', 'D1',
        'D0', 'B1', 'A0', 'F1',
        'F0', 'B1', 'A0', 'F1',
    ],
    
    // Voice allocation & Priority Queue
    MAX_VOICES: 10,
    activeVoices: [],
    lastPlayTimes: {},
    
    // XP Gem combo tier tracking
    gemComboCount: 0,
    lastGemPickupTime: 0,
    
    // Mute & Volume State
    isMuted: false,
    masterVolume: 0.35,
    musicVolume: 0.12,
    FX_VOICE_GAIN: 0.70,

    // Pre-render a lush stereo synthetic impulse response for spatial room convolution
    buildImpulseResponse(duration = 0.5, decay = 2.0) {
        if (!this.ctx) return null;
        const sampleRate = this.ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * duration);
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const env = Math.pow(1 - i / length, decay);
            left[i] = (Math.random() * 2 - 1) * env;
            right[i] = (Math.random() * 2 - 1) * env;
        }
        return impulse;
    },

    // Pre-render ZzFX parameter array into an AudioBuffer (zero GC during gameplay)
    buildZzfxBuffer(params) {
        if (!this.ctx) return null;
        let [volume = 1, randomness = .05, frequency = 220, attack = 0, sustain = 0, release = .1,
             shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0,
             repeatTime = 0, noise = 0, modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1,
             decay = 0, tremolo = 0, filter = 0] = params;

        let sampleRate = this.ctx.sampleRate || 44100;
        let PI2 = Math.PI * 2, abs = Math.abs, sign = v => v < 0 ? -1 : 1;
        let startSlide = slide *= 500 * PI2 / sampleRate / sampleRate;
        let startFrequency = frequency *= (1 + randomness * 2 * Math.random() - randomness) * PI2 / sampleRate;
        let modOffset = 0, repeat = 0, crush = 0, jump = 1, length, b = [], t = 0, i = 0, s = 0, f;

        let quality = 2, w = PI2 * abs(filter) * 2 / sampleRate;
        let cos = Math.cos(w), alpha = Math.sin(w) / 2 / quality;
        let a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
        let b0 = (1 + sign(filter) * cos) / 2 / a0, b1 = -(sign(filter) + cos) / a0, b2 = b0;
        let x2 = 0, x1 = 0, y2 = 0, y1 = 0;

        const minAttack = 9;
        attack = attack * sampleRate || minAttack;
        decay *= sampleRate;
        sustain *= sampleRate;
        release *= sampleRate;
        delay *= sampleRate;
        deltaSlide *= 500 * PI2 / sampleRate ** 3;
        modulation *= PI2 / sampleRate;
        pitchJump *= PI2 / sampleRate;
        pitchJumpTime *= sampleRate;
        repeatTime = repeatTime * sampleRate | 0;

        for (length = attack + decay + sustain + release + delay | 0; i < length; b[i++] = s * volume) {
            if (!(++crush % (bitCrush * 100 | 0))) {
                s = shape ? shape > 1 ? shape > 2 ? shape > 3 ? shape > 4 ?
                    (t / PI2 % 1 < shapeCurve / 2) * 2 - 1 :
                    Math.sin(t ** 3) :
                    Math.max(Math.min(Math.tan(t), 1), -1) :
                    1 - (2 * t / PI2 % 2 + 2) % 2 :
                    1 - 4 * abs(Math.round(t / PI2) - t / PI2) :
                    Math.sin(t);

                s = (repeatTime ? 1 - tremolo + tremolo * Math.sin(PI2 * i / repeatTime) : 1) *
                    (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
                    (i < attack ? i / attack :
                    i < attack + decay ? 1 - ((i - attack) / decay) * (1 - sustainVolume) :
                    i < attack + decay + sustain ? sustainVolume :
                    i < length - delay ? (length - i - delay) / release * sustainVolume : 0);

                s = delay ? s / 2 + (delay > i ? 0 : (i < length - delay ? 1 : (length - i) / delay) * b[i - delay | 0] / 2 / volume) : s;

                if (filter)
                    s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
            }

            f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
            t += f + f * noise * Math.sin(i ** 5);

            if (jump && ++jump > pitchJumpTime) {
                frequency += pitchJump;
                startFrequency += pitchJump;
                jump = 0;
            }

            if (repeatTime && !(++repeat % repeatTime)) {
                frequency = startFrequency;
                slide = startSlide;
                jump = jump || 1;
            }
        }

        // Peak-normalization (prevents clipping, ensures consistent loudness)
        let maxVal = 0;
        for (let idx = 0; idx < b.length; idx++) {
            const absVal = Math.abs(b[idx]);
            if (absVal > maxVal) maxVal = absVal;
        }
        if (maxVal > 0) {
            const targetPeak = 0.95;
            const normFactor = targetPeak / maxVal;
            for (let idx = 0; idx < b.length; idx++) {
                b[idx] *= normFactor;
            }
        }

        const buffer = this.ctx.createBuffer(1, b.length, sampleRate);
        buffer.getChannelData(0).set(b);
        return buffer;
    },

    // Pre-render SFXR parameter object into an AudioBuffer (zero GC during gameplay)
    buildSfxrBuffer(ps) {
        if (!this.ctx) return null;
        const OVERSAMPLING = 8;
        const SQUARE = 0, SAWTOOTH = 1, SINE = 2, NOISE = 3;

        let elapsedSinceRepeat = 0;
        let period = 100 / (ps.p_base_freq * ps.p_base_freq + 0.001);
        let periodMax = 100 / (ps.p_freq_limit * ps.p_freq_limit + 0.001);
        let enableFrequencyCutoff = (ps.p_freq_limit > 0);
        let periodMult = 1 - Math.pow(ps.p_freq_ramp, 3) * 0.01;
        let periodMultSlide = -Math.pow(ps.p_freq_dramp, 3) * 0.000001;

        let dutyCycle = 0.5 - ps.p_duty * 0.5;
        let dutyCycleSlide = -ps.p_duty_ramp * 0.00005;

        let arpeggioMultiplier;
        if (ps.p_arp_mod >= 0)
            arpeggioMultiplier = 1 - Math.pow(ps.p_arp_mod, 2) * .9;
        else
            arpeggioMultiplier = 1 + Math.pow(ps.p_arp_mod, 2) * 10;
        let arpeggioTime = Math.floor(Math.pow(1 - ps.p_arp_speed, 2) * 20000 + 32);
        if (ps.p_arp_speed === 1) arpeggioTime = 0;

        let waveShape = parseInt(ps.wave_type);
        let fltw = Math.pow(ps.p_lpf_freq, 3) * 0.1;
        let enableLowPassFilter = (ps.p_lpf_freq != 1);
        let fltw_d = 1 + ps.p_lpf_ramp * 0.0001;
        let fltdmp = 5 / (1 + Math.pow(ps.p_lpf_resonance, 2) * 20) * (0.01 + fltw);
        if (fltdmp > 0.8) fltdmp = 0.8;
        let flthp = Math.pow(ps.p_hpf_freq, 2) * 0.1;
        let flthp_d = 1 + ps.p_hpf_ramp * 0.0003;

        let vibratoSpeed = Math.pow(ps.p_vib_speed, 2) * 0.01;
        let vibratoAmplitude = ps.p_vib_strength * 0.5;

        let envelopeLength = [
            Math.floor(ps.p_env_attack * ps.p_env_attack * 100000),
            Math.floor(ps.p_env_sustain * ps.p_env_sustain * 100000),
            Math.floor(ps.p_env_decay * ps.p_env_decay * 100000)
        ];
        let envelopePunch = ps.p_env_punch;

        let flangerOffset = Math.pow(ps.p_pha_offset, 2) * 1020;
        if (ps.p_pha_offset < 0) flangerOffset = -flangerOffset;
        let flangerOffsetSlide = Math.pow(ps.p_pha_ramp, 2) * 1;
        if (ps.p_pha_ramp < 0) flangerOffsetSlide = -flangerOffsetSlide;

        let repeatTime = Math.floor(Math.pow(1 - ps.p_repeat_speed, 2) * 20000 + 32);
        if (ps.p_repeat_speed === 0) repeatTime = 0;

        let gain = Math.exp(ps.sound_vol) - 1;
        let sampleRate = ps.sample_rate || 44100;

        let fltp = 0, fltdp = 0, fltphp = 0;
        let noise_buffer = Array(32);
        for (let i = 0; i < 32; ++i) noise_buffer[i] = Math.random() * 2 - 1;

        let envelopeStage = 0, envelopeElapsed = 0, vibratoPhase = 0, phase = 0, ipp = 0;
        let flanger_buffer = Array(1024).fill(0);
        let normalized = [];
        let sample_sum = 0, num_summed = 0, summands = Math.floor(44100 / sampleRate) || 1;

        function initForRepeat() {
            elapsedSinceRepeat = 0;
            period = 100 / (ps.p_base_freq * ps.p_base_freq + 0.001);
            periodMax = 100 / (ps.p_freq_limit * ps.p_freq_limit + 0.001);
            enableFrequencyCutoff = (ps.p_freq_limit > 0);
            periodMult = 1 - Math.pow(ps.p_freq_ramp, 3) * 0.01;
            periodMultSlide = -Math.pow(ps.p_freq_dramp, 3) * 0.000001;
            dutyCycle = 0.5 - ps.p_duty * 0.5;
            dutyCycleSlide = -ps.p_duty_ramp * 0.00005;
            if (ps.p_arp_mod >= 0)
                arpeggioMultiplier = 1 - Math.pow(ps.p_arp_mod, 2) * .9;
            else
                arpeggioMultiplier = 1 + Math.pow(ps.p_arp_mod, 2) * 10;
            arpeggioTime = Math.floor(Math.pow(1 - ps.p_arp_speed, 2) * 20000 + 32);
            if (ps.p_arp_speed === 1) arpeggioTime = 0;
        }

        for (let t = 0; ; ++t) {
            if (repeatTime != 0 && ++elapsedSinceRepeat >= repeatTime) initForRepeat();

            if (arpeggioTime != 0 && t >= arpeggioTime) {
                arpeggioTime = 0;
                period *= arpeggioMultiplier;
            }

            periodMult += periodMultSlide;
            period *= periodMult;
            if (period > periodMax) {
                period = periodMax;
                if (enableFrequencyCutoff) break;
            }

            let rfperiod = period;
            if (vibratoAmplitude > 0) {
                vibratoPhase += vibratoSpeed;
                rfperiod = period * (1 + Math.sin(vibratoPhase) * vibratoAmplitude);
            }
            let iperiod = Math.floor(rfperiod);
            if (iperiod < OVERSAMPLING) iperiod = OVERSAMPLING;

            dutyCycle += dutyCycleSlide;
            if (dutyCycle < 0) dutyCycle = 0;
            if (dutyCycle > 0.5) dutyCycle = 0.5;

            if (++envelopeElapsed > envelopeLength[envelopeStage]) {
                envelopeElapsed = 0;
                if (++envelopeStage > 2) break;
            }

            let env_vol;
            let envf = envelopeElapsed / envelopeLength[envelopeStage];
            if (envelopeStage === 0) env_vol = envf;
            else if (envelopeStage === 1) env_vol = 1 + (1 - envf) * 2 * envelopePunch;
            else env_vol = 1 - envf;

            flangerOffset += flangerOffsetSlide;
            let iphase = Math.abs(Math.floor(flangerOffset));
            if (iphase > 1023) iphase = 1023;

            if (flthp_d != 0) {
                flthp *= flthp_d;
                if (flthp < 0.00001) flthp = 0.00001;
                if (flthp > 0.1) flthp = 0.1;
            }

            let sample = 0;
            for (let si = 0; si < OVERSAMPLING; ++si) {
                let sub_sample = 0;
                phase++;
                if (phase >= iperiod) {
                    phase %= iperiod;
                    if (waveShape === NOISE)
                        for (let i = 0; i < 32; ++i) noise_buffer[i] = Math.random() * 2 - 1;
                }

                let fp = phase / iperiod;
                if (waveShape === SQUARE) {
                    sub_sample = fp < dutyCycle ? 0.5 : -0.5;
                } else if (waveShape === SAWTOOTH) {
                    sub_sample = fp < dutyCycle ? -1 + 2 * fp / dutyCycle : 1 - 2 * (fp - dutyCycle) / (1 - dutyCycle);
                } else if (waveShape === SINE) {
                    sub_sample = Math.sin(fp * 2 * Math.PI);
                } else if (waveShape === NOISE) {
                    sub_sample = noise_buffer[Math.floor(phase * 32 / iperiod)];
                }

                let pp = fltp;
                fltw *= fltw_d;
                if (fltw < 0) fltw = 0;
                if (fltw > 0.1) fltw = 0.1;
                if (enableLowPassFilter) {
                    fltdp += (sub_sample - fltp) * fltw;
                    fltdp -= fltdp * fltdmp;
                } else {
                    fltp = sub_sample;
                    fltdp = 0;
                }
                fltp += fltdp;

                fltphp += fltp - pp;
                fltphp -= fltphp * flthp;
                sub_sample = fltphp;

                flanger_buffer[ipp & 1023] = sub_sample;
                sub_sample += flanger_buffer[(ipp - iphase + 1024) & 1023];
                ipp = (ipp + 1) & 1023;

                sample += sub_sample * env_vol;
            }

            sample_sum += sample;
            if (++num_summed >= summands) {
                num_summed = 0;
                sample = sample_sum / summands;
                sample_sum = 0;
            } else {
                continue;
            }

            sample = sample / OVERSAMPLING;
            sample *= gain;
            normalized.push(sample);
        }

        // Peak-normalization (prevents clipping, ensures consistent loudness)
        let maxVal = 0;
        for (let idx = 0; idx < normalized.length; idx++) {
            const absVal = Math.abs(normalized[idx]);
            if (absVal > maxVal) maxVal = absVal;
        }
        if (maxVal > 0) {
            const targetPeak = 0.95;
            const normFactor = targetPeak / maxVal;
            for (let idx = 0; idx < normalized.length; idx++) {
                normalized[idx] *= normFactor;
            }
        }

        const buffer = this.ctx.createBuffer(1, normalized.length, sampleRate);
        buffer.getChannelData(0).set(normalized);
        return buffer;
    },

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            return this.ctx;
        }
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            this.ctx = new AudioContextClass();
            
            // Master Gain Node
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
            
            // Master Dynamics Compressor (Limiter against clipping)
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
            this.compressor.knee.setValueAtTime(8, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
            this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
            this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);
            
            // Ducking Gain (for Critical priority sidechaining)
            this.duckingGain = this.ctx.createGain();
            this.duckingGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
            
            // Sub-Buses
            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.setValueAtTime(this.isMuted ? 0 : 1.0, this.ctx.currentTime);

            this.musicBus = this.ctx.createGain();
            this.musicBus.gain.setValueAtTime(this.isMusicMuted ? 0 : this.musicVolume, this.ctx.currentTime);

            // Music Parametric Rough EQ:
            // 1. Medium notch on mid frequencies (-7 dB @ 1000 Hz, Q 1.0)
            this.musicMidEq = this.ctx.createBiquadFilter();
            this.musicMidEq.type = 'peaking';
            this.musicMidEq.frequency.setValueAtTime(1000, this.ctx.currentTime);
            this.musicMidEq.Q.setValueAtTime(1.0, this.ctx.currentTime);
            this.musicMidEq.gain.setValueAtTime(-7.0, this.ctx.currentTime);

            // 2. Low shelf cut on high frequencies (-3.5 dB @ 5000 Hz)
            this.musicHighEq = this.ctx.createBiquadFilter();
            this.musicHighEq.type = 'highshelf';
            this.musicHighEq.frequency.setValueAtTime(5000, this.ctx.currentTime);
            this.musicHighEq.gain.setValueAtTime(-3.5, this.ctx.currentTime);

            // 3. Dynamic sweep lowpass filter (starts @ 400 Hz -> sweeps to 20 kHz; bass < 400 Hz stays unfiltered)
            this.musicFilter = this.ctx.createBiquadFilter();
            this.musicFilter.type = 'lowpass';
            this.musicFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
            this.musicFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);
            
            this.uiBus = this.ctx.createGain();
            this.uiBus.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
            
            // Global Spatial Dynamic Reverb Bus for SFX (Develops alongside music reverb with cubic decay: 2.2^3, 1.7^3, 1.8^3)
            this.fxReverbConvolverStart = this.ctx.createConvolver();
            this.fxReverbConvolverStart.buffer = this.buildImpulseResponse(4.5, Math.pow(2.2, 3)); // 4.5s, cubic decay ~10.65

            this.fxReverbConvolverEnd = this.ctx.createConvolver();
            this.fxReverbConvolverEnd.buffer = this.buildImpulseResponse(1.6, Math.pow(1.7, 3)); // 1.6s, cubic decay ~4.91

            this.fxReverbConvolverVictory = this.ctx.createConvolver();
            this.fxReverbConvolverVictory.buffer = this.buildImpulseResponse(9.0, Math.pow(1.8, 3)); // 9.0s, cubic decay ~5.83

            this.fxWetGainStart = this.ctx.createGain();
            this.fxWetGainStart.gain.setValueAtTime(0.40, this.ctx.currentTime); // Starts at 20% wet return

            this.fxWetGainEnd = this.ctx.createGain();
            this.fxWetGainEnd.gain.setValueAtTime(0.0, this.ctx.currentTime);

            this.fxWetGainVictory = this.ctx.createGain();
            this.fxWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);

            this.reverbDryGain = this.ctx.createGain();
            this.reverbDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime); // 50% direct dry path

            // Melody Dynamic Reverb Bus (Starts spacious: 4.5s decay 2.2 -> Ends rich & sustained: 1.6s decay 1.7 -> Victory 9.0s ambient decay 1.8)
            this.musicReverbConvolverStart = this.ctx.createConvolver();
            this.musicReverbConvolverStart.buffer = this.buildImpulseResponse(4.5, 2.2);

            this.musicReverbConvolverEnd = this.ctx.createConvolver();
            this.musicReverbConvolverEnd.buffer = this.buildImpulseResponse(1.6, 1.7);

            this.musicReverbConvolverVictory = this.ctx.createConvolver();
            this.musicReverbConvolverVictory.buffer = this.buildImpulseResponse(9.0, 1.8);

            this.musicWetGainStart = this.ctx.createGain();
            this.musicWetGainStart.gain.setValueAtTime(0.68, this.ctx.currentTime);

            this.musicWetGainEnd = this.ctx.createGain();
            this.musicWetGainEnd.gain.setValueAtTime(0.0, this.ctx.currentTime);

            this.musicWetGainVictory = this.ctx.createGain();
            this.musicWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);

            this.musicDryGain = this.ctx.createGain();
            this.musicDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

            // Connect Graph:
            // sfxBus -> reverbDryGain -> duckingGain
            // sfxBus -> fxReverbConvolverStart -> fxWetGainStart -> duckingGain
            // sfxBus -> fxReverbConvolverEnd -> fxWetGainEnd -> duckingGain
            // sfxBus -> fxReverbConvolverVictory -> fxWetGainVictory -> duckingGain
            // musicBus -> musicMidEq -> musicHighEq -> musicFilter -> musicDryGain -> duckingGain
            // musicFilter -> musicReverbConvolverStart -> musicWetGainStart -> duckingGain
            // musicFilter -> musicReverbConvolverEnd -> musicWetGainEnd -> duckingGain
            // musicFilter -> musicReverbConvolverVictory -> musicWetGainVictory -> duckingGain
            // duckingGain -> compressor -> masterGain -> destination
            // uiBus -> masterGain -> destination
            this.sfxBus.connect(this.reverbDryGain);
            this.reverbDryGain.connect(this.duckingGain);

            this.sfxBus.connect(this.fxReverbConvolverStart);
            this.sfxBus.connect(this.fxReverbConvolverEnd);
            this.sfxBus.connect(this.fxReverbConvolverVictory);

            this.fxReverbConvolverStart.connect(this.fxWetGainStart);
            this.fxReverbConvolverEnd.connect(this.fxWetGainEnd);
            this.fxReverbConvolverVictory.connect(this.fxWetGainVictory);

            this.fxWetGainStart.connect(this.duckingGain);
            this.fxWetGainEnd.connect(this.duckingGain);
            this.fxWetGainVictory.connect(this.duckingGain);

            this.musicBus.connect(this.musicMidEq);
            this.musicMidEq.connect(this.musicHighEq);
            this.musicHighEq.connect(this.musicFilter);

            this.musicFilter.connect(this.musicDryGain);
            this.musicFilter.connect(this.musicReverbConvolverStart);
            this.musicFilter.connect(this.musicReverbConvolverEnd);
            this.musicFilter.connect(this.musicReverbConvolverVictory);

            this.musicReverbConvolverStart.connect(this.musicWetGainStart);
            this.musicReverbConvolverEnd.connect(this.musicWetGainEnd);
            this.musicReverbConvolverVictory.connect(this.musicWetGainVictory);

            this.musicDryGain.connect(this.duckingGain);
            this.musicWetGainStart.connect(this.duckingGain);
            this.musicWetGainEnd.connect(this.duckingGain);
            this.musicWetGainVictory.connect(this.duckingGain);

            this.duckingGain.connect(this.compressor);
            this.compressor.connect(this.masterGain);
            
            this.uiBus.connect(this.masterGain);
            this.masterGain.connect(this.ctx.destination);
            
            // Pre-allocate 0.5-second white noise buffer (zero GC overhead during gameplay)
            const bufferSize = Math.floor(this.ctx.sampleRate * 0.5);
            this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            // Pre-render SFXR Sniper Shot buffer (high-pitched Magic Missile with shorter attack and longer release)
            const sfxrSniperPreset = {
                wave_type: 2,
                p_env_attack: 0.01,
                p_env_sustain: 0.04,
                p_env_punch: 0,
                p_env_decay: 0.28,
                p_base_freq: 1.5,
                p_freq_limit: 0,
                p_freq_ramp: -0.32,
                p_freq_dramp: 0.18,
                p_vib_strength: 0,
                p_vib_speed: 0,
                p_arp_mod: -1,
                p_arp_speed: 0,
                p_duty: 0.7919760591157696,
                p_duty_ramp: -0.28015083413655467,
                p_repeat_speed: 0,
                p_pha_offset: 0.1404706566781668,
                p_pha_ramp: -0.0038287628234192407,
                p_lpf_freq: 1,
                p_lpf_ramp: 0,
                p_lpf_resonance: 0,
                p_hpf_freq: 0.28,
                p_hpf_ramp: 0.999,
                sound_vol: 0.22,
                sample_rate: this.ctx.sampleRate || 44100
            };
            this.laserBuffer = this.buildSfxrBuffer(sfxrSniperPreset);

            // Pre-render ZzFX Phase Dash buffer [.4,,391.9954,.06,,.12,2,1.6,37,,,,,1.5,,,,.9,.02,,-742] (~0.20s snappy warp woosh)
            this.dashBuffer = this.buildZzfxBuffer([.4,,391.9954,.06,,.12,2,1.6,37,,,,,1.5,,,,.9,.02,,-742]);

            // Pre-render ZzFX Melee Sweep buffer [0.25,,2600,.015,.005,.035,,3.5,-4,1,,,,1,,,,.8,.005] (~0.06s ultra-crisp blade sweep)
            this.meleeBuffer = this.buildZzfxBuffer([0.25,,2600,.015,.005,.035,,3.5,-4,1,,,,1,,,,.8,.005]);

            // Pre-render ZzFX Flamethrower buffer [0.4,,84,.37,.1,.45,2,,,-0.1,,,,30,,.2,,.49,.13,,637] (~1.05s continuous flame roar)
            this.flameBuffer = this.buildZzfxBuffer([0.4,,84,.37,.1,.45,2,,,-0.1,,,,30,,.2,,.49,.13,,637]);

            // Pre-render ZzFX Enemy Freeze buffer [,,1e4,,.005,.035,5,1.1,7,12,,,,,48,,,.75,.01,,6970] (~0.05s crisp frost snap)
            this.freezeBuffer = this.buildZzfxBuffer([,,1e4,,.005,.035,5,1.1,7,12,,,,,48,,,.75,.01,,6970]);

            // Pre-render ZzFX Meteor Fall buffer [0.3,,200,.58,.01,.008,2,.3,,-0.1,,,,2,12,.2,.1,.96,.59] scaled to METEOR_FALL_MS (1.2s)
            const meteorFallScale = (METEOR_FALL_MS / 1000) / (0.58 + 0.59 + 0.01 + 0.008 + 0.1);
            this.meteorFallBuffer = this.buildZzfxBuffer([
                0.3, undefined, 200, 0.58 * meteorFallScale, 0.01 * meteorFallScale, 0.008 * meteorFallScale,
                2, 0.3, undefined, -0.1, undefined, undefined,
                undefined, 2, 12, 0.2, 0.1 * meteorFallScale, 0.96, 0.59 * meteorFallScale
            ]);

            // Pre-render ZzFX Dasher / Jumper Leap buffer [,,388,.03,.05,.07,5,.8,1,195,,,,,,.1,,.99,.03,,-1230]
            this.dasherJumpBuffer = this.buildZzfxBuffer([,,388,.03,.05,.07,5,.8,1,195,,,,,,.1,,.99,.03,,-1230]);

            // Pre-render SFXR Magic Missile buffer
            const sfxrMissilePreset = {
                wave_type: 2,
                p_env_attack: 0.084,
                p_env_sustain: 0.228,
                p_env_punch: 0,
                p_env_decay: 1,
                p_base_freq: 1,
                p_freq_limit: 0.19,
                p_freq_ramp: -0.445,
                p_freq_dramp: 0.276,
                p_vib_strength: 0,
                p_vib_speed: 0,
                p_arp_mod: -1,
                p_arp_speed: 0,
                p_duty: 0.7919760591157696,
                p_duty_ramp: -0.28015083413655467,
                p_repeat_speed: 0,
                p_pha_offset: 0.1404706566781668,
                p_pha_ramp: -0.0038287628234192407,
                p_lpf_freq: 1,
                p_lpf_ramp: 0,
                p_lpf_resonance: 0,
                p_hpf_freq: 0.238,
                p_hpf_ramp: 0.999,
                sound_vol: 0.25,
                sample_rate: this.ctx.sampleRate || 44100
            };
            this.missileBuffer = this.buildSfxrBuffer(sfxrMissilePreset);

            // Pre-render SFXR Shooter Dark Missile buffer (darker, slower variant of magic missile)
            const sfxrShooterPreset = {
                wave_type: 2,
                p_env_attack: 0.14,
                p_env_sustain: 0.35,
                p_env_punch: 0,
                p_env_decay: 1,
                p_base_freq: 0.65,
                p_freq_limit: 0.12,
                p_freq_ramp: -0.25,
                p_freq_dramp: 0.15,
                p_vib_strength: 0,
                p_vib_speed: 0,
                p_arp_mod: -1,
                p_arp_speed: 0,
                p_duty: 0.72,
                p_duty_ramp: -0.22,
                p_repeat_speed: 0,
                p_pha_offset: 0.18,
                p_pha_ramp: -0.004,
                p_lpf_freq: 0.62,
                p_lpf_ramp: -0.05,
                p_lpf_resonance: 0.2,
                p_hpf_freq: 0.04,
                p_hpf_ramp: 0.0,
                sound_vol: 0.28,
                sample_rate: this.ctx.sampleRate || 44100
            };
            this.shooterMissileBuffer = this.buildSfxrBuffer(sfxrShooterPreset);

            // Pre-render ZzFX Octopus Tentacle Lash buffer [1.3,,120,.02,.2,.01,4,1.2,-0.7,-0.5,,,.05,.6,12,.1,.27,.79,.05,.44,-2021]
            this.tentacleLashBuffer = this.buildZzfxBuffer([1.3,,120,.02,.2,.01,4,1.2,-0.7,-0.5,,,.05,.6,12,.1,.27,.79,.05,.44,-2021]);

            // Pre-render ZzFX Stalker Blink buffer [0.75,,520,.08,,.01,2,3.9,-2,-5,-130,.13,.01,,,.5,,.97,.02] (~0.11s high warp blink)
            this.stalkerBlinkBuffer = this.buildZzfxBuffer([0.75,,520,.08,,.01,2,3.9,-2,-5,-130,.13,.01,,,.5,,.97,.02]);

            // Pre-render ZzFX Felhound Gallop buffer (deep low-frequency beast gallop footstep)
            this.felhoundGallopBuffer = this.buildZzfxBuffer([,,48,.019,.02,.035,1,2.3,-5.7,,70,.06,.01,.3,10,,,.94,.03,.11]);

            // Pre-render ZzFX Medivac Heal buffer [1.1,0,247,.22,.04,.25,,1.2,,,,,.12,.3,,.1,.1,.57,.14,.54]
            this.medivacHealBuffer = this.buildZzfxBuffer([1.1,0,247,.22,.04,.25,,1.2,,,,,.12,.3,,.1,.1,.57,.14,.54]);

            // Pre-render ZzFX Hellion Flame Burst buffer [0.75,,95,.08,.10,.18,2,,,-0.1,,,,25,,.2,,.52,.08,,600] (~0.44s flame burst)
            this.hellionFlameBuffer = this.buildZzfxBuffer([0.75,,95,.08,.10,.18,2,,,-0.1,,,,25,,.2,,.52,.08,,600]);

            // Pre-render ZzFX Warp Anomaly Collapse buffer [1.5,,40,.02,,.5,1,2,,,,,.09,1,,.3,,.43,.2,.42,-3e3] (~0.72s gravitational shockwave)
            this.warpAnomalyBuffer = this.buildZzfxBuffer([1.5,,40,.02,,.5,1,2,,,,,.09,1,,.3,,.43,.2,.42,-3e3]);

            // Pre-render ZzFX Viper / Titan Tongue buffer [1.1,,332,.03,.47,.09,,2.1,1,36,,,.12,,18,,,.84,.08,.12] (~0.67s fleshy abduct tongue whip)
            this.viperTongueBuffer = this.buildZzfxBuffer([1.1,,332,.03,.47,.09,,2.1,1,36,,,.12,,18,,,.84,.08,.12]);

            // Pre-render ZzFX Titan Sprint buffer [,,110,.2,,.05,,2,,.7,,,,.3,26,,,.6,.75,,105] (~1.0s heavy thundering sprint launch)
            this.titanSprintBuffer = this.buildZzfxBuffer([,,110,.2,,.05,,2,,.7,,,,.3,26,,,.6,.75,,105]);

            // Pre-render ZzFX Titan Underground Rumble buffer [,,200,.12,,.12,1,2,,,,,.13,.3,26,-0.1,.01,,.75,.31,105] (~1.0s continuous subterranean seismic rumble)
            this.titanUndergroundBuffer = this.buildZzfxBuffer([,,200,.12,,.12,1,2,,,,,.13,.3,26,-0.1,.01,,.75,.31,105]);

            // Pre-render ZzFX Titan Kaiser Cleave / Cone Attack buffer [.8,,40,.03,.05,.15,,4,-8,-4,,,,.4,32,.1,,.44,.1,,-1996] (~0.33s heavy cone impact slam)
            this.behemothCleaveBuffer = this.buildZzfxBuffer([.8,,40,.03,.05,.15,,4,-8,-4,,,,.4,32,.1,,.44,.1,,-1996]);

            // Pre-render ZzFX Visceral Damage buffer [2.3,,300,.04,,.07,,.4,-5,,-50,.33,,.6,2,,.1,.96,.06]
            this.damageBuffer = this.buildZzfxBuffer([2.3,,300,.04,,.07,,.4,-5,,-50,.33,,.6,2,,.1,.96,.06]);

            // Pre-render ZzFX Boss Warning buffer [1.2,,120,.2,.8,.25,5,1.1,,1.2,,,,.1,,,.02,,,.23] (~1.27s ominous countdown pulse)
            this.bossWarningBuffer = this.buildZzfxBuffer([1.2,,120,.2,.8,.25,5,1.1,,1.2,,,,.1,,,.02,,,.23]);
            
            // Load persisted mute preferences
            try {
                if (localStorage.getItem('blob_survival_muted') === 'true') {
                    this.setMute(true);
                }
                if (localStorage.getItem('blob_survival_music_muted') === 'true') {
                    this.setMusicMute(true);
                }
            } catch(e) {}
            
            return this.ctx;
        } catch (err) {
            console.warn('AudioContext init failed:', err);
            return null;
        }
    },

    toggleMute() {
        this.setMute(!this.isMuted);
    },

    setMute(muted) {
        this.isMuted = muted;
        try {
            localStorage.setItem('blob_survival_muted', muted ? 'true' : 'false');
        } catch(e) {}
        
        if (this.sfxBus && this.ctx) {
            this.sfxBus.gain.setValueAtTime(this.isMuted ? 0 : 1.0, this.ctx.currentTime);
        }
        if (this.uiBus && this.ctx) {
            this.uiBus.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
        }
        
        const btn = document.getElementById('soundToggleBtn');
        if (btn) {
            btn.innerHTML = `<span class="audio-icon">${this.isMuted ? '🔇' : '🔊'}</span> <span class="audio-label">SFX: ${this.isMuted ? 'OFF' : 'ON'}</span>`;
            btn.classList.toggle('muted', this.isMuted);
            btn.title = this.isMuted ? 'Unmute SFX (M)' : 'Mute SFX (M)';
        }
    },

    toggleMusicMute() {
        this.setMusicMute(!this.isMusicMuted);
    },

    setMusicMute(muted) {
        this.isMusicMuted = muted;
        try {
            localStorage.setItem('blob_survival_music_muted', muted ? 'true' : 'false');
        } catch(e) {}

        if (this.musicBus && this.ctx) {
            this.musicBus.gain.setValueAtTime(this.isMusicMuted ? 0 : this.musicVolume, this.ctx.currentTime);
        }

        const btn = document.getElementById('musicToggleBtn');
        if (btn) {
            btn.innerHTML = `<span class="audio-icon">${this.isMusicMuted ? '🔇' : '🎵'}</span> <span class="audio-label">Music: ${this.isMusicMuted ? 'OFF' : 'ON'}</span>`;
            btn.classList.toggle('muted', this.isMusicMuted);
            btn.title = this.isMusicMuted ? 'Unmute Music (N)' : 'Mute Music (N)';
        }
    },

    setMuffled(muffled, durationSeconds = 0.5) {
        this.isMuffled = muffled;
        const nowMs = performance.now();
        this.tempoTransitionStartFactor = this.tempoFactor || 1.0;
        this.targetTempoFactor = muffled ? 0.8 : 1.0;
        this.tempoTransitionStartTime = nowMs;
        this.tempoTransitionDuration = durationSeconds;

        if (!this.ctx || !this.musicFilter) return;
        const now = this.ctx.currentTime;
        const progressCutoff = this.getFilterCutoff();
        const targetFreq = muffled ? Math.min(300, progressCutoff) : progressCutoff;
        this.musicFilter.frequency.cancelScheduledValues(now);
        this.musicFilter.frequency.setValueAtTime(Math.max(100, this.musicFilter.frequency.value || (muffled ? progressCutoff : 400)), now);
        this.musicFilter.frequency.exponentialRampToValueAtTime(Math.max(100, targetFreq), now + Math.max(0.05, durationSeconds));
    },

    startMenuMusic(forceReset = false) {
        this.init();
        if (!forceReset && this.isMusicPlaying && !this.isMusicPaused && this.musicMode === 'menu') {
            // Menu music is already actively playing, keep it playing seamlessly without restarting
            if (this.isMuffled && this.setMuffled) {
                this.setMuffled(false);
            }
            return;
        }
        this.isVictoryRamping = false;
        this.musicMode = 'menu';
        this.isMusicPlaying = true;
        this.isMusicPaused = false;
        this.isMuffled = false;
        this.tempoFactor = 1.0;
        this.targetTempoFactor = 1.0;
        this.tempoTransitionDuration = 0;
        this.musicElapsedMs = 0;
        this.musicStep = 0;
        this.musicLastTickTime = performance.now();
        if (this.ctx) {
            this.musicNextNoteTime = this.ctx.currentTime + 0.05;
            if (this.musicFilter) {
                this.musicFilter.frequency.cancelScheduledValues(this.ctx.currentTime);
                this.musicFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
            }
            if (this.musicWetGainStart) {
                this.musicWetGainStart.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainStart.gain.setValueAtTime(0.68, this.ctx.currentTime);
            }
            if (this.musicWetGainEnd) {
                this.musicWetGainEnd.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainEnd.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
            if (this.musicWetGainVictory) {
                this.musicWetGainVictory.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
            if (this.fxWetGainStart) {
                this.fxWetGainStart.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainStart.gain.setValueAtTime(0.20, this.ctx.currentTime);
            }
            if (this.fxWetGainEnd) {
                this.fxWetGainEnd.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainEnd.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
            if (this.fxWetGainVictory) {
                this.fxWetGainVictory.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
        }
    },

    startMusic(forceReset = true, startElapsedMs = 0) {
        this.init();
        this.isVictoryRamping = false;
        if (!forceReset && this.musicMode === 'gameplay' && this.isMusicPlaying) {
            this.resumeMusic();
            return;
        }
        this.musicMode = 'gameplay';
        this.isMusicPlaying = true;
        this.isMusicPaused = false;
        this.isMuffled = false;
        this.tempoFactor = 1.0;
        this.targetTempoFactor = 1.0;
        this.tempoTransitionDuration = 0;
        this.musicElapsedMs = startElapsedMs || 0;
        this.musicStep = 0;
        this.musicLastTickTime = performance.now();
        if (this.ctx) {
            this.musicNextNoteTime = this.ctx.currentTime + 0.05;
            const progressCutoff = this.getFilterCutoff();
            const revProg = this.getReverbProgress();
            const invRevProg = Math.max(0.0, Math.min(1.0, 1.0 - revProg));
            if (this.musicFilter) {
                this.musicFilter.frequency.cancelScheduledValues(this.ctx.currentTime);
                this.musicFilter.frequency.setValueAtTime(progressCutoff, this.ctx.currentTime);
            }
            if (this.musicWetGainStart) {
                this.musicWetGainStart.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainStart.gain.setValueAtTime(0.68 * Math.pow(invRevProg, 1.2), this.ctx.currentTime);
            }
            if (this.musicWetGainEnd) {
                this.musicWetGainEnd.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainEnd.gain.setValueAtTime(0.68 * Math.pow(revProg, 0.8), this.ctx.currentTime);
            }
            if (this.musicWetGainVictory) {
                this.musicWetGainVictory.gain.cancelScheduledValues(this.ctx.currentTime);
                this.musicWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
            if (this.fxWetGainStart) {
                this.fxWetGainStart.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainStart.gain.setValueAtTime(0.20 * Math.pow(invRevProg, 1.2), this.ctx.currentTime);
            }
            if (this.fxWetGainEnd) {
                this.fxWetGainEnd.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainEnd.gain.setValueAtTime(0.20 * Math.pow(revProg, 0.8), this.ctx.currentTime);
            }
            if (this.fxWetGainVictory) {
                this.fxWetGainVictory.gain.cancelScheduledValues(this.ctx.currentTime);
                this.fxWetGainVictory.gain.setValueAtTime(0.0, this.ctx.currentTime);
            }
        }
    },

    stopMusic() {
        this.isMusicPlaying = false;
        this.isMusicPaused = false;
        this.isMuffled = false;
        this.isVictoryRamping = false;
        this.tempoFactor = 1.0;
        this.targetTempoFactor = 1.0;
        this.tempoTransitionDuration = 0;
        this.musicElapsedMs = 0;
        this.musicStep = 0;
    },

    triggerVictoryRamp(durationSeconds = 3.0) {
        if (!this.ctx || !this.isMusicPlaying) return;
        this.isVictoryRamping = true;
        this.victoryStartTime = performance.now();
        this.victoryDuration = durationSeconds * 1000;
        const currentSpeedProg = this.getSpeedProgress();
        this.victoryStartBpm = (10 + (140 - 10) * currentSpeedProg) * (this.tempoFactor || 1.0);
        this.victoryStartWet = (this.musicWetGainEnd && Number.isFinite(this.musicWetGainEnd.gain.value)) ? this.musicWetGainEnd.gain.value : 0.68;
        this.victoryStartFxWet = (this.fxWetGainEnd && Number.isFinite(this.fxWetGainEnd.gain.value)) ? this.fxWetGainEnd.gain.value : 0.20;
    },

    pauseMusic() {
        this.isMusicPaused = true;
        this.musicLastTickTime = 0;
    },

    resumeMusic() {
        if (!this.isMusicPaused) return;
        this.isMusicPaused = false;
        this.musicLastTickTime = performance.now();
        if (this.ctx && this.musicNextNoteTime < this.ctx.currentTime) {
            this.musicNextNoteTime = this.ctx.currentTime + 0.05;
        }
    },

    getSynthNoteBuffer(noteName, progress) {
        if (!noteName || noteName === '-') return null;
        const tier = Math.floor(progress * 30);
        const cacheKey = noteName + '_' + tier;
        if (this.musicNoteCache[cacheKey]) {
            return this.musicNoteCache[cacheKey];
        }

        const freq = this.MELODY_NOTES[noteName] || 110;
        const bpm = 10 + (140 - 10) * progress;
        const stepDuration = 60 / (bpm * 4);

        // Long attack in beginning (~0.35s) smoothly tapering to 8ms over 24 minutes
        const rawAttack = 0.35 * Math.pow(1 - progress, 1.5) + 0.008;
        const attack = Math.min(rawAttack, stepDuration * 0.6);
        const sustain = 0.35 * Math.pow(1 - progress, 1.4) + 0.02;
        const decay = 0.3; // Fixed 0.3s release

        const noteParams = [
            1.0,            // volume scale
            0,              // randomness = 0 (perfect melodic pitch)
            freq,           // frequency
            attack,         // attack duration (long at start, tight over 24 minutes)
            sustain,        // sustain duration (shortens over 24 minutes)
            decay,          // decay duration (shortens over 24 minutes)
            2,              // shape (2 = Sawtooth)
            1,              // shapeCurve
            0,              // slide
            0,              // deltaSlide
            0,              // pitchJump
            0,              // pitchJumpTime
            0,              // repeatTime
            0.2,            // noise
            0,              // modulation
            0,              // bitCrush
            0,              // delay
            1,              // sustainVolume
            0,              // decayCycle
            0,              // tremolo
            0               // filter
        ];

        const buffer = this.buildZzfxBuffer(noteParams);
        if (buffer) {
            this.musicNoteCache[cacheKey] = buffer;
        }
        return buffer;
    },

    updateMusic(now) {
        if (!this.isMusicPlaying || this.isMusicPaused || !this.ctx || this.isMusicMuted) {
            if (this.isMusicPlaying) this.musicLastTickTime = now;
            return;
        }

        if (!this.musicLastTickTime) {
            this.musicLastTickTime = now;
        }
        const dt = Math.min(100, now - this.musicLastTickTime);
        this.musicLastTickTime = now;

        if (this.musicMode === 'menu') {
            // Loading / Menu Screen Melody: Fixed 95 BPM, 400 Hz lowpass filter, 3.5s early reverb
            const bpm = 95 * this.tempoFactor;
            const stepDuration = 60 / (bpm * 4);
            const progress95 = (95 - 10) / (140 - 10); // Synth settings at 95 BPM

            if (this.musicFilter && !this.isMuffled) {
                if (Number.isFinite(this.ctx.currentTime)) {
                    this.musicFilter.frequency.setTargetAtTime(400, this.ctx.currentTime, 0.05);
                }
            }
            if (this.musicWetGainStart && this.musicWetGainEnd && this.ctx && !this.isMuffled) {
                this.musicWetGainStart.gain.setTargetAtTime(0.68, this.ctx.currentTime, 0.05);
                this.musicWetGainEnd.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
            }

            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }

            if (this.musicNextNoteTime < this.ctx.currentTime) {
                this.musicNextNoteTime = this.ctx.currentTime + 0.02;
            }

            const lookahead = 0.15;
            while (this.musicNextNoteTime < this.ctx.currentTime + lookahead) {
                const playTime = Math.max(this.ctx.currentTime, this.musicNextNoteTime);
                const seq = this.LOADING_MELODY_SEQUENCE;
                const noteName = seq[this.musicStep % seq.length];

                if (noteName && noteName !== '-') {
                    const buffer = this.getSynthNoteBuffer(noteName, progress95);
                    if (buffer) {
                        const source = this.ctx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(this.musicBus || this.masterGain);
                        source.start(playTime);
                        source.stop(playTime + buffer.duration + 0.02);
                    }
                }

                this.musicNextNoteTime += stepDuration;
                this.musicStep++;
            }
            return;
        }

        // Victory Mode: Ramp down tempo to 10 BPM and transition to 9.0s ambient reverb over 3s
        if (this.isVictoryRamping) {
            const elapsed = now - this.victoryStartTime;
            const t = Math.min(1.0, Math.max(0.0, elapsed / this.victoryDuration));

            // Morph reverb from 1.6s tail into 9.0s ambient tail over 3 seconds
            if (this.musicWetGainEnd && this.musicWetGainVictory && this.ctx) {
                const endGain = this.victoryStartWet * (1.0 - t);
                const victoryGain = 0.85 * t;
                this.musicWetGainEnd.gain.setTargetAtTime(endGain, this.ctx.currentTime, 0.05);
                this.musicWetGainVictory.gain.setTargetAtTime(victoryGain, this.ctx.currentTime, 0.05);
                if (this.musicWetGainStart) {
                    this.musicWetGainStart.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
                }
            }
            if (this.fxWetGainEnd && this.fxWetGainVictory && this.ctx) {
                const endFxGain = (this.victoryStartFxWet || 0.20) * (1.0 - t);
                const victoryFxGain = 0.25 * t;
                this.fxWetGainEnd.gain.setTargetAtTime(endFxGain, this.ctx.currentTime, 0.05);
                this.fxWetGainVictory.gain.setTargetAtTime(victoryFxGain, this.ctx.currentTime, 0.05);
                if (this.fxWetGainStart) {
                    this.fxWetGainStart.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
                }
            }

            if (elapsed >= this.victoryDuration) {
                // 3 seconds elapsed: stop scheduling new notes, allowing the 9s reverb tail to cling out naturally
                this.isVictoryRamping = false;
                this.isMusicPlaying = false;
                return;
            }

            // Smoothly decrease tempo down to 10 BPM over 3 seconds
            const currentBpm = this.victoryStartBpm + (10 - this.victoryStartBpm) * t;
            const stepDuration = 60 / (currentBpm * 4);

            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }

            if (this.musicNextNoteTime < this.ctx.currentTime) {
                this.musicNextNoteTime = this.ctx.currentTime + 0.02;
            }

            const lookahead = 0.15;
            while (this.musicNextNoteTime < this.ctx.currentTime + lookahead) {
                const playTime = Math.max(this.ctx.currentTime, this.musicNextNoteTime);
                const noteName = this.MELODY_SEQUENCE[this.musicStep % this.MELODY_SEQUENCE.length];
                if (noteName && noteName !== '-') {
                    const speedProg = Math.max(0, 1.0 - t);
                    const buffer = this.getSynthNoteBuffer(noteName, speedProg);
                    if (buffer) {
                        const source = this.ctx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(this.musicBus || this.masterGain);
                        source.start(playTime);
                        source.stop(playTime + buffer.duration + 0.02);
                    }
                }

                this.musicNextNoteTime += stepDuration;
                this.musicStep++;
            }
            return;
        }

        // Gameplay Mode:
        // Progress advances continuously during active gameplay (frozen while muffled/in menus)
        if (!this.isMuffled && GAME_STATE.current === STATES.GAMEPLAY) {
            if (typeof GAME_STATE.elapsed === 'number' && GAME_STATE.elapsed >= 0) {
                this.musicElapsedMs = GAME_STATE.elapsed;
            } else {
                this.musicElapsedMs = (this.musicElapsedMs || 0) + dt;
            }
        }

        const speedProg = this.getSpeedProgress();
        const progressCutoff = this.getFilterCutoff();
        const revProg = this.getReverbProgress();
        const invRevProg = Math.max(0.0, Math.min(1.0, 1.0 - revProg));

        // Smooth tempo transition (80% in menus, transitioning over durationSeconds)
        if (this.tempoTransitionDuration > 0) {
            const elapsed = (now - this.tempoTransitionStartTime) / (this.tempoTransitionDuration * 1000);
            const t = Math.min(1.0, Math.max(0.0, elapsed));
            this.tempoFactor = this.tempoTransitionStartFactor + (this.targetTempoFactor - this.tempoTransitionStartFactor) * t;
        } else {
            this.tempoFactor = this.isMuffled ? 0.8 : 1.0;
        }

        // Lowpass filter sweep: 400 Hz -> 20 kHz from minute 0 to 24 (p^2.2 power curve)
        if (this.musicFilter && !this.isMuffled && GAME_STATE.current === STATES.GAMEPLAY) {
            if (Number.isFinite(progressCutoff) && Number.isFinite(this.ctx.currentTime)) {
                this.musicFilter.frequency.setTargetAtTime(progressCutoff, this.ctx.currentTime, 0.05);
            }
        }

        // Dynamic melody & FX reverb morphing over 24 minutes
        if (this.musicWetGainStart && this.musicWetGainEnd && this.ctx && !this.isMuffled && GAME_STATE.current === STATES.GAMEPLAY) {
            const startWet = 0.68 * Math.pow(invRevProg, 1.2);
            const endWet = 0.68 * Math.pow(revProg, 0.8);
            if (Number.isFinite(startWet) && Number.isFinite(this.ctx.currentTime)) {
                this.musicWetGainStart.gain.setTargetAtTime(startWet, this.ctx.currentTime, 0.05);
            }
            if (Number.isFinite(endWet) && Number.isFinite(this.ctx.currentTime)) {
                this.musicWetGainEnd.gain.setTargetAtTime(endWet, this.ctx.currentTime, 0.05);
            }
        }
        if (this.fxWetGainStart && this.fxWetGainEnd && this.ctx && !this.isMuffled && GAME_STATE.current === STATES.GAMEPLAY) {
            const fxStartWet = 0.20 * Math.pow(invRevProg, 1.2);
            const fxEndWet = 0.20 * Math.pow(revProg, 0.8);
            if (Number.isFinite(fxStartWet) && Number.isFinite(this.ctx.currentTime)) {
                this.fxWetGainStart.gain.setTargetAtTime(fxStartWet, this.ctx.currentTime, 0.05);
            }
            if (Number.isFinite(fxEndWet) && Number.isFinite(this.ctx.currentTime)) {
                this.fxWetGainEnd.gain.setTargetAtTime(fxEndWet, this.ctx.currentTime, 0.05);
            }
        }

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        // Catch up safely if audio clock drifted ahead during any unhandled frame pause
        if (this.musicNextNoteTime < this.ctx.currentTime) {
            this.musicNextNoteTime = this.ctx.currentTime + 0.02;
        }

        const lookahead = 0.15;
        while (this.musicNextNoteTime < this.ctx.currentTime + lookahead) {
            const playTime = Math.max(this.ctx.currentTime, this.musicNextNoteTime);
            const baseBpm = 10 + (140 - 10) * speedProg;
            const bpm = baseBpm * this.tempoFactor;
            const stepDuration = 60 / (bpm * 4);

            const noteName = this.MELODY_SEQUENCE[this.musicStep % this.MELODY_SEQUENCE.length];
            if (noteName && noteName !== '-') {
                const buffer = this.getSynthNoteBuffer(noteName, speedProg);
                if (buffer) {
                    const source = this.ctx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(this.musicBus || this.masterGain);
                    source.start(playTime);
                    source.stop(playTime + buffer.duration + 0.02);
                }
            }

            this.musicNextNoteTime += stepDuration;
            this.musicStep++;
        }
    },

    // Throttle duplicate sounds in same frame / short sliding window
    throttle(soundId, minIntervalMs) {
        const now = performance.now();
        if (now - (this.lastPlayTimes[soundId] || 0) < minIntervalMs) {
            return false;
        }
        this.lastPlayTimes[soundId] = now;
        return true;
    },

    // Small random pitch/rate variance so frequently-repeated sounds don't feel robotic
    randPitch(spread = 0.1) {
        return 1 + (Math.random() * 2 - 1) * spread;
    },

    // Priority-based voice allocation with voice stealing
    allocateVoice(priority, soundId, durationSeconds, isUI = false) {
        if (this.isMuted) return null;
        const ctx = this.init();
        if (!ctx) return null;
        
        const now = ctx.currentTime;
        
        // Clean up expired voices
        this.activeVoices = this.activeVoices.filter(v => v.endTime > now);
        
        // Check voice cap
        if (this.activeVoices.length >= this.MAX_VOICES) {
            // Find lowest priority active voice
            let minIndex = -1;
            let minPriority = Infinity;
            for (let i = 0; i < this.activeVoices.length; i++) {
                if (this.activeVoices[i].priority < minPriority) {
                    minPriority = this.activeVoices[i].priority;
                    minIndex = i;
                }
            }
            // Voice stealing: replace only if new sound has strictly higher priority
            if (minIndex !== -1 && priority > minPriority) {
                const stolen = this.activeVoices.splice(minIndex, 1)[0];
                try {
                    stolen.gainNode.gain.cancelScheduledValues(now);
                    stolen.gainNode.gain.setValueAtTime(stolen.gainNode.gain.value, now);
                    stolen.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.005);
                    if (stolen.stopFn) setTimeout(stolen.stopFn, 10);
                } catch(e) {}
            } else {
                return null; // Voice pool saturated with higher or equal priority sounds
            }
        }
        
        // Dynamic Sidechain Ducking on CRITICAL priority events
        if (priority === this.PRIORITY.CRITICAL && this.duckingGain) {
            try {
                this.duckingGain.gain.cancelScheduledValues(now);
                this.duckingGain.gain.setValueAtTime(this.duckingGain.gain.value, now);
                this.duckingGain.gain.linearRampToValueAtTime(0.55, now + 0.015); // -5 dB
                this.duckingGain.gain.setValueAtTime(0.55, now + 0.35);
                this.duckingGain.gain.linearRampToValueAtTime(1.0, now + 0.50);
            } catch(e) {}
        }
        
        const voiceGain = ctx.createGain();
        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
        const dest = isUI ? this.uiBus : this.sfxBus;
        voiceGain.connect(dest);
        
        const voiceRecord = {
            id: soundId,
            priority,
            gainNode: voiceGain,
            endTime: now + durationSeconds + 0.05,
            stopFn: null
        };
        this.activeVoices.push(voiceRecord);
        
        return { ctx, now, voiceGain, voiceRecord };
    },

    // ---------------- Sound Recipes ----------------

    // 1. CRITICAL: Player Death (sub-bass descending thud & flatline tone)
    playerDeath() {
        if (!this.throttle('player_death', 150)) return;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'player_death', 0.8);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.7);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(350, now);
        filter.frequency.exponentialRampToValueAtTime(45, now + 0.7);

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
        voiceGain.gain.linearRampToValueAtTime(0.001, now + 0.75);

        osc.connect(filter);
        filter.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.8);
        v.voiceRecord.stopFn = () => { try { osc.stop(); } catch(e){} };
    },

    // 2. CRITICAL: Player Revived (uplifting ascending dual-chime)
    playerRevived() {
        if (!this.throttle('player_revived', 200)) return;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'player_revived', 0.6);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const freqs = [587.33, 880.0, 1174.66, 1760.0]; // D5, A5, D6, A6
        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);

            noteGain.gain.setValueAtTime(0, now + i * 0.08);
            noteGain.gain.linearRampToValueAtTime(1.0, now + i * 0.08 + 0.03);
            noteGain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);

            osc.connect(noteGain);
            noteGain.connect(voiceGain);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.38);
        });
    },

    // 3. CRITICAL: Level Up (4-note sparkling major arpeggio)
    levelUp() {
        if (!this.throttle('level_up', 250)) return;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'level_up', 0.65, true);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.07);

            noteGain.gain.setValueAtTime(0, now + idx * 0.07);
            noteGain.gain.linearRampToValueAtTime(1.0, now + idx * 0.07 + 0.02);
            noteGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.3);

            osc.connect(noteGain);
            noteGain.connect(voiceGain);
            osc.start(now + idx * 0.07);
            osc.stop(now + idx * 0.07 + 0.35);
        });
    },

    // 4. CRITICAL: Nuclear Blast (deep sub-bass shockwave rumble)
    nukeExplosion() {
        if (!this.throttle('nuke', 300)) return;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'nuke', 1.0);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.loop = true;
            noise.playbackRate.value = this.randPitch(0.02);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(380, now);
            filter.frequency.exponentialRampToValueAtTime(42, now + 0.95);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 3, now);
            voiceGain.gain.linearRampToValueAtTime(0.001, now + 0.95);

            noise.connect(filter);
            filter.connect(voiceGain);
            noise.start(now);
            noise.stop(now + 1.0);
            v.voiceRecord.stopFn = () => { try { noise.stop(); } catch(e){} };
        }
    },

    // 5. CRITICAL: Boss Pre-Wave Warning Alarm (plays 4 times 5s before boss wave)
    bossWarning() {
        if (!this.throttle('boss_warning', 800)) return;
        const duration = (this.bossWarningBuffer && this.bossWarningBuffer.duration) ? this.bossWarningBuffer.duration : 1.27;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'boss_warning', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.bossWarningBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.bossWarningBuffer;

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 6. CRITICAL: Campervan Rampage (retro dual-tone vehicle horn)
    campervan() {
        if (!this.throttle('campervan', 500)) return;
        const v = this.allocateVoice(this.PRIORITY.CRITICAL, 'campervan', 0.6);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        [440, 554.37].forEach(f => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, now);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1400, now);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now + 0.45);
            voiceGain.gain.linearRampToValueAtTime(0.001, now + 0.55);

            osc.connect(filter);
            filter.connect(voiceGain);
            osc.start(now);
            osc.stop(now + 0.6);
        });
    },

    // 7. HIGH: Player Damaged (ZzFX visceral impact thud)
    playerDamaged() {
        if (!this.throttle('player_damaged', 70)) return;
        const duration = 0.28;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'player_damaged', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.damageBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.damageBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 8. HIGH: Phase Dash (ZzFX warp displacement)
    phaseDash() {
        if (!this.throttle('phase_dash', 100)) return;
        const duration = (this.dashBuffer && this.dashBuffer.duration) ? this.dashBuffer.duration : 0.20;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'phase_dash', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.dashBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.dashBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 9. HIGH: Deflector Shield Block (resonant metallic laser clang)
    shieldBlock() {
        if (!this.throttle('shield_block', 60)) return;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'shield_block', 0.2);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const osc = ctx.createOscillator();
        const shieldPitch = this.randPitch();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(2200 * shieldPitch, now);
        osc.frequency.exponentialRampToValueAtTime(900 * shieldPitch, now + 0.18);

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(7.0, now); // Metallic ring
        filter.frequency.setValueAtTime(2200, now);
        filter.frequency.exponentialRampToValueAtTime(1100, now + 0.18);

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc.connect(filter);
        filter.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.2);
    },

    // 10. HIGH: Supply Drop Landed (crisp high double-ping)
    supplyDrop() {
        if (!this.throttle('supply_drop', 200)) return;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'supply_drop', 0.25);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);

        [0, 0.08].forEach((delay, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime((i === 0 ? 3200 : 4800) * this.randPitch(), now + delay);

            const noteGain = ctx.createGain();
            noteGain.gain.setValueAtTime(1.0, now + delay);
            noteGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);

            osc.connect(noteGain);
            noteGain.connect(voiceGain);
            osc.start(now + delay);
            osc.stop(now + delay + 0.14);
        });
    },

    // 11. MEDIUM: Proximity Mine Explosion (low-pass noise sweep)
    mineExplosion(scale = 1.0) {
        if (!this.throttle('mine_explosion', 50)) return;
        const duration = Math.min(0.45, 0.22 * Math.max(0.7, scale));
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'mine_explosion', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.playbackRate.value = this.randPitch(0.15);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(280 * Math.min(1.5, scale), now);
            filter.frequency.exponentialRampToValueAtTime(55, now + duration);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 4.5, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noise.connect(filter);
            filter.connect(voiceGain);
            noise.start(now);
            noise.stop(now + duration + 0.02);
        }
    },

    // 12. MEDIUM: Melee Sweep & Sledge Hammer
    meleeSweep(isSledge = false) {
        const tag = isSledge ? 'sledge' : 'melee';
        if (!this.throttle(tag, isSledge ? 100 : 80)) return;
        const duration = isSledge ? 0.14 : ((this.meleeBuffer && this.meleeBuffer.duration) ? this.meleeBuffer.duration : 0.06);
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, tag, duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (isSledge) {
            const osc = ctx.createOscillator();
            const sledgePitch = this.randPitch(0.12);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180 * sledgePitch, now);
            osc.frequency.exponentialRampToValueAtTime(45 * sledgePitch, now + duration);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(250, now);
            filter.frequency.exponentialRampToValueAtTime(70, now + duration);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 2.0, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.connect(filter);
            filter.connect(voiceGain);
            osc.start(now);
            osc.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { osc.stop(); } catch(e){} };
        } else if (this.meleeBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.meleeBuffer;
            source.playbackRate.value = this.randPitch(0.15);

            // Mid-frequency scoop filter to remove muddy mid-range resonance
            const midFilter = ctx.createBiquadFilter();
            midFilter.type = 'peaking';
            midFilter.frequency.setValueAtTime(1100, now);
            midFilter.Q.setValueAtTime(1.2, now);
            midFilter.gain.setValueAtTime(-14, now);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.09, now);

            source.connect(midFilter);
            midFilter.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 13. MEDIUM: Flamethrower Jet (ZzFX fire burst)
    flamethrower() {
        if (!this.throttle('flame', 150)) return;
        const duration = (this.flameBuffer && this.flameBuffer.duration) ? this.flameBuffer.duration : 1.05;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'flame', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.flameBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.flameBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.15, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 13b. LOW: Fire Ring Hit (softer, shorter flame puff when fireball hits an enemy)
    fireRingHit() {
        if (!this.throttle('fire_ring_hit', 40)) return;
        const duration = 0.54;
        const v = this.allocateVoice(this.PRIORITY.LOW, 'fire_ring_hit', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.flameBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.flameBuffer;
            source.playbackRate.value = this.randPitch();

            const flameGain = ctx.createGain();
            flameGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.5, now);
            flameGain.gain.exponentialRampToValueAtTime(0.003, now + duration);

            source.connect(flameGain);
            flameGain.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        } else if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.playbackRate.value = this.randPitch();

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, now);
            filter.frequency.exponentialRampToValueAtTime(120, now + duration);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.38, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(voiceGain);
            noise.start(now);
            noise.stop(now + duration + 0.02);
        }
    },

    // 14. MEDIUM: Magic Missile (Player: MEDIUM, Turret: LOW)
    missileFire(soundVolumeFactor = 1.0, isTurret = false) {
        const throttleKey = isTurret ? 'turret_missile_fire' : 'missile_fire';
        const throttleMs = isTurret ? 50 : 35;
        if (!this.throttle(throttleKey, throttleMs)) return;
        const duration = 0.10;
        const priority = isTurret ? this.PRIORITY.LOW : this.PRIORITY.MEDIUM;
        const v = this.allocateVoice(priority, throttleKey, duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.missileBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.missileBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.9 * soundVolumeFactor, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 15. MEDIUM: Sniper Shot (SFXR high-pitched Magic Missile with short attack and long release)
    laserSniper() {
        if (!this.throttle('laser_sniper', 60)) return;
        const duration = (this.laserBuffer && this.laserBuffer.duration) ? this.laserBuffer.duration : 0.18;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'laser_sniper', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.laserBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.laserBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.16, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 16. LOW: XP Gem Pickup (pure sine bell with ascending combo scale)
    gemPickup() {
        if (!this.throttle('gem_pickup', 25)) return;
        const nowMs = performance.now();
        if (nowMs - this.lastGemPickupTime > 600) {
            this.gemComboCount = 0;
        }
        this.lastGemPickupTime = nowMs;
        const tier = this.gemComboCount % 5;
        this.gemComboCount++;

        const v = this.allocateVoice(this.PRIORITY.LOW, 'gem_pickup', 0.08);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        // Pentatonic crystal scale: E7 (2637), G7 (3136), A7 (3520), B7 (3951), D8 (4698)
        const scale = [2637.02, 3135.96, 3520.0, 3951.07, 4698.63];
        const freq = scale[tier] * this.randPitch(0.02);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.08, now + 0.07);

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.25, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.08);
    },

    // 18. LOW: UI Button Click (monster hit sound)
    uiClick() {
        if (!this.throttle('ui_click', 40)) return;
        const v = this.allocateVoice(this.PRIORITY.LOW, 'ui_click', 0.035, true);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.playbackRate.value = this.randPitch();

            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(1600, now);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.7, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

            noise.connect(filter);
            filter.connect(voiceGain);
            noise.start(now);
            noise.stop(now + 0.035);
        }
    },

    // 19. MEDIUM: Seeking Rocket Launch (thruster ignition thump + rising exhaust sweep)
    rocketLaunch() {
        if (!this.throttle('rocket_launch', 40)) return;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'rocket_launch', 0.35);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        // 1. Ignition punch
        const osc = ctx.createOscillator();
        const rocketPitch = this.randPitch();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140 * rocketPitch, now);
        osc.frequency.exponentialRampToValueAtTime(35 * rocketPitch, now + 0.15);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.8, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(oscGain);
        oscGain.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.16);

        // 2. Thruster whoosh noise sweep
        if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.playbackRate.value = this.randPitch();

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.setValueAtTime(2.0, now);
            filter.frequency.setValueAtTime(320, now);
            filter.frequency.exponentialRampToValueAtTime(1400, now + 0.18);
            filter.frequency.exponentialRampToValueAtTime(450, now + 0.32);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.01, now);
            noiseGain.gain.linearRampToValueAtTime(1.0, now + 0.04);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(voiceGain);
            noise.start(now);
            noise.stop(now + 0.35);
        }
    },

    // 20. MEDIUM: Scourge Flail Meaty Hit (deep organic impact thud + visceral flesh crunch)
    flailHit(speed = 1.0) {
        if (!this.throttle('flail_hit', 35)) return;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'flail_hit', 0.18);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.6, now);

        const spdFactor = Math.min(2.0, Math.max(0.7, speed * 0.3));
        const flailPitch = this.randPitch(0.15);

        // Sub/Mid impact thud
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120 * spdFactor * flailPitch, now);
        osc.frequency.exponentialRampToValueAtTime(32 * flailPitch, now + 0.14);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(1.6, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        osc.connect(oscGain);
        oscGain.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.15);

        // Meaty visceral squelch / crunch layer
        if (this.noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.playbackRate.value = this.randPitch();

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(450, now);
            filter.frequency.exponentialRampToValueAtTime(80, now + 0.12);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.9, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(voiceGain);
            noise.start(now);
            noise.stop(now + 0.15);
        }
    },

    // 22. MEDIUM: Autonomous Network Construction (mechanical ratchet clicks + pneumatic weld power-up)
    autonomousNetwork() {
        if (!this.throttle('autonomous_network', 120)) return;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'autonomous_network', 0.38);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        // Mechanical construction ratchet clicks (2 rapid clicks)
        const netPitch = this.randPitch();
        [0, 0.07].forEach((delay, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime((i === 0 ? 880 : 1320) * netPitch, now + delay);
            osc.frequency.exponentialRampToValueAtTime(200 * netPitch, now + delay + 0.035);

            const clickGain = ctx.createGain();
            clickGain.gain.setValueAtTime(0.6, now + delay);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.035);

            osc.connect(clickGain);
            clickGain.connect(voiceGain);
            osc.start(now + delay);
            osc.stop(now + delay + 0.04);
        });

        // Rising energetic weld / construction power tone
        const tone = ctx.createOscillator();
        tone.type = 'sine';
        tone.frequency.setValueAtTime(330 * netPitch, now + 0.12);
        tone.frequency.exponentialRampToValueAtTime(660 * netPitch, now + 0.28);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1800, now + 0.12);

        const toneGain = ctx.createGain();
        toneGain.gain.setValueAtTime(0.001, now);
        toneGain.gain.setValueAtTime(0.01, now + 0.12);
        toneGain.gain.linearRampToValueAtTime(0.7, now + 0.20);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        tone.connect(filter);
        filter.connect(toneGain);
        toneGain.connect(voiceGain);
        tone.start(now + 0.12);
        tone.stop(now + 0.36);
    },

    // 23. LOW: Enemy Freeze (ZzFX crystalline frost snap & shimmer)
    enemyFreeze() {
        if (!this.throttle('enemy_freeze', 40)) return;
        const duration = (this.freezeBuffer && this.freezeBuffer.duration) ? this.freezeBuffer.duration : 0.05;
        const v = this.allocateVoice(this.PRIORITY.LOW, 'enemy_freeze', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.freezeBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.freezeBuffer;
            source.playbackRate.value = this.randPitch(0.15);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.10, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 24. HIGH: Meteor Falling Entry (ZzFX atmospheric reentry rush scaled to fall duration)
    meteorFall(durationSec = 1.2) {
        if (!this.throttle('meteor_fall', 120)) return;
        const dur = (typeof durationSec === 'number' && durationSec > 0) ? durationSec : (METEOR_FALL_MS / 1000);
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'meteor_fall', dur);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        let buffer = (Math.abs(dur - (METEOR_FALL_MS / 1000)) < 0.05) ? this.meteorFallBuffer : null;
        if (!buffer) {
            const baseDuration = 0.58 + 0.59 + 0.01 + 0.008 + 0.1; // 1.288
            const scale = dur / baseDuration;
            buffer = this.buildZzfxBuffer([
                0.3, undefined, 200, 0.58 * scale, 0.01 * scale, 0.008 * scale,
                2, 0.3, undefined, -0.1, undefined, undefined,
                undefined, 2, 12, 0.2, 0.1 * scale, 0.96, 0.59 * scale
            ]);
        }

        if (buffer) {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.12, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + dur + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 25. HIGH: Dasher / Jumper Leap (ZzFX aggressive attack jump screech & pounce)
    dasherJump() {
        if (!this.throttle('dasher_jump', 60)) return;
        const duration = (this.dasherJumpBuffer && this.dasherJumpBuffer.duration) ? this.dasherJumpBuffer.duration : 0.18;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'dasher_jump', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.dasherJumpBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.dasherJumpBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.5, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 26. HIGH: Shooter Dark Missile (darker, slower SFXR projectile launch)
    shooterFire() {
        if (!this.throttle('shooter_fire', 50)) return;
        const duration = (this.shooterMissileBuffer && this.shooterMissileBuffer.duration) ? this.shooterMissileBuffer.duration : 0.45;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'shooter_fire', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.shooterMissileBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.shooterMissileBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.85, now);
            voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 27. HIGH: Octopus Boss Tentacle Lash (ZzFX visceral whipping tentacle whipcrack)
    tentacleLash() {
        if (!this.throttle('tentacle_lash', 50)) return;
        const duration = (this.tentacleLashBuffer && this.tentacleLashBuffer.duration) ? this.tentacleLashBuffer.duration : 0.55;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'tentacle_lash', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.tentacleLashBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.tentacleLashBuffer;
            source.playbackRate.value = this.randPitch(0.07);

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.95, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 28. HIGH: Stalker Blink (ZzFX warp teleport phase displacement)
    stalkerBlink() {
        if (!this.throttle('stalker_blink', 50)) return;
        const duration = (this.stalkerBlinkBuffer && this.stalkerBlinkBuffer.duration) ? this.stalkerBlinkBuffer.duration : 0.12;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'stalker_blink', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.stalkerBlinkBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.stalkerBlinkBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.15, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 30. HIGH: Felhound Boss Gallop (ZzFX aggressive bounding beast footstep)
    felhoundGallop() {
        if (!this.throttle('felhound_gallop', 120)) return;
        const duration = (this.felhoundGallopBuffer && this.felhoundGallopBuffer.duration) ? this.felhoundGallopBuffer.duration : 0.07;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'felhound_gallop', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.felhoundGallopBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.felhoundGallopBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.9, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 31. HIGH: Hellion Flame Jet (ZzFX punchy burst flame roar adapted from flamethrower)
    hellionFlame() {
        if (!this.throttle('hellion_flame', 120)) return;
        const duration = (this.hellionFlameBuffer && this.hellionFlameBuffer.duration) ? this.hellionFlameBuffer.duration : 0.34;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'hellion_flame', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.hellionFlameBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.hellionFlameBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.30, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 32. HIGH: Warp Anomaly Collapse / Detonation (ZzFX cosmic gravitational singularity pulse)
    warpAnomaly() {
        if (!this.throttle('warp_anomaly', 100)) return;
        const duration = (this.warpAnomalyBuffer && this.warpAnomalyBuffer.duration) ? this.warpAnomalyBuffer.duration : 0.72;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'warp_anomaly', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.warpAnomalyBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.warpAnomalyBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.0, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 33. HIGH: Viper / Titan Tongue Launch (ZzFX fleshy abduct tongue whip)
    viperTongue() {
        if (!this.throttle('viper_tongue', 100)) return;
        const duration = (this.viperTongueBuffer && this.viperTongueBuffer.duration) ? this.viperTongueBuffer.duration : 0.67;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'viper_tongue', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.viperTongueBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.viperTongueBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.0, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 34. HIGH: Titan Sprint Launch (ZzFX heavy thundering charge sprint)
    titanSprint() {
        if (!this.throttle('titan_sprint', 300)) return;
        const duration = (this.titanSprintBuffer && this.titanSprintBuffer.duration) ? this.titanSprintBuffer.duration : 1.0;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'titan_sprint', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.titanSprintBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.titanSprintBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.05, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // 35. HIGH: Titan Underground Travel & Entrance Rumble (ZzFX continuous subterranean seismic pulse)
    titanUnderground() {
        if (!this.throttle('titan_underground', 750)) return;
        const duration = (this.titanUndergroundBuffer && this.titanUndergroundBuffer.duration) ? this.titanUndergroundBuffer.duration : 1.0;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'titan_underground', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.titanUndergroundBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.titanUndergroundBuffer;

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.0, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    behemothCleave() {
        if (!this.throttle('behemoth_cleave', 250)) return;
        const duration = (this.behemothCleaveBuffer && this.behemothCleaveBuffer.duration) ? this.behemothCleaveBuffer.duration : 0.33;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'behemoth_cleave', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.behemothCleaveBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.behemothCleaveBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 1.1, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    behemothMortar() {
        if (!this.throttle('behemoth_mortar', 250)) return;
        const v = this.allocateVoice(this.PRIORITY.MEDIUM, 'behemoth_mortar', 0.35);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const osc = ctx.createOscillator();
        const mortarPitch = this.randPitch();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80 * mortarPitch, now);
        osc.frequency.exponentialRampToValueAtTime(320 * mortarPitch, now + 0.15);
        osc.frequency.exponentialRampToValueAtTime(140 * mortarPitch, now + 0.32);

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.9, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

        osc.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.35);
    },

    behemothBurrow() {
        if (!this.throttle('behemoth_burrow', 500)) return;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'behemoth_burrow', 0.6);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const osc = ctx.createOscillator();
        const burrowPitch = this.randPitch();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140 * burrowPitch, now);
        osc.frequency.exponentialRampToValueAtTime(35 * burrowPitch, now + 0.55);

        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

        osc.connect(voiceGain);
        osc.start(now);
        osc.stop(now + 0.6);
    },

    // Medivac Heal Beam (ZzFX soothing bio-energy resonance pulse)
    medivacHeal() {
        if (!this.throttle('medivac_heal', 420)) return;
        const duration = (this.medivacHealBuffer && this.medivacHealBuffer.duration) ? this.medivacHealBuffer.duration : 0.75;
        const v = this.allocateVoice(this.PRIORITY.HIGH, 'medivac_heal', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        if (this.medivacHealBuffer) {
            const source = ctx.createBufferSource();
            source.buffer = this.medivacHealBuffer;
            source.playbackRate.value = this.randPitch();

            voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * 0.2, now);

            source.connect(voiceGain);
            source.start(now);
            source.stop(now + duration + 0.02);
            v.voiceRecord.stopFn = () => { try { source.stop(); } catch(e){} };
        }
    },

    // Player Health Restored / Health Pack Pickup / Second Wind (Harmonic uplifting bio-energy major chime)
    heal(volumeMode = 'low') {
        if (!this.throttle('player_heal', 100)) return;
        const isMajor = (volumeMode === 'medium' || volumeMode === 'high' || volumeMode >= 0.5);
        const duration = isMajor ? 0.60 : 0.40;
        const priority = isMajor ? this.PRIORITY.CRITICAL : this.PRIORITY.LOW;
        const v = this.allocateVoice(priority, 'player_heal', duration);
        if (!v) return;
        const { ctx, now, voiceGain } = v;

        const volScale = isMajor ? 0.85 : 0.45;
        voiceGain.gain.setValueAtTime(this.FX_VOICE_GAIN * volScale, now);

        const freqs = isMajor 
            ? [587.33, 880.0, 1174.66, 1760.0]  // D5, A5, D6, A6 (full ascending 4-note major chord)
            : [880.0, 1174.66, 1760.0];         // A5, D6, A6 (quick uplifting 3-note health pack chime)

        const step = isMajor ? 0.08 : 0.06;
        const noteDur = isMajor ? 0.35 : 0.25;

        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * step);

            noteGain.gain.setValueAtTime(0, now + i * step);
            noteGain.gain.linearRampToValueAtTime(1.0, now + i * step + 0.025);
            noteGain.gain.exponentialRampToValueAtTime(0.001, now + i * step + noteDur);

            osc.connect(noteGain);
            noteGain.connect(voiceGain);
            osc.start(now + i * step);
            osc.stop(now + i * step + noteDur + 0.03);
        });
    },

    // 19. Progressive Soundtrack Synth Note (Eric Prydz 'Opus' style progressive sawtooth synth)
    // Preset recipe: [, 0, freq, 0.01, sustain, decay, 2, , , , , , , 0.2, , , , , , 0.18]
    playSynthNote(freq = 110, sustain = 0.33, decay = 0.4, volume = 0.3) {
        if (!this.ctx || this.isMuted) return null;
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        const now = this.ctx.currentTime;
        const noteParams = [
            volume,         // 0: volume
            0,              // 1: randomness (0 = deterministic pitch for melody)
            freq,           // 2: frequency in Hz
            0.01,           // 3: attack (10ms)
            sustain,        // 4: sustain duration (decreases as tempo accelerates)
            decay,          // 5: decay/release duration (decreases as tempo accelerates)
            2,              // 6: shape (2 = Sawtooth wave)
            1,              // 7: shapeCurve
            0,              // 8: slide
            0,              // 9: deltaSlide
            0,              // 10: pitchJump
            0,              // 11: pitchJumpTime
            0,              // 12: repeatTime
            0,              // 13: noise
            0.2,            // 14: modulation (gentle analog chorusing)
            0,              // 15: bitCrush
            0,              // 16: delay
            1,              // 17: sustainVolume
            0,              // 18: decayCycle
            0,              // 19: tremolo
            0.18            // 20: filter
        ];

        const buffer = this.buildZzfxBuffer(noteParams);
        if (!buffer) return null;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const noteGain = this.ctx.createGain();
        noteGain.gain.setValueAtTime(1.0, now);

        source.connect(noteGain);
        noteGain.connect(this.musicBus || this.sfxBus || this.masterGain);

        source.start(now);
        source.stop(now + buffer.duration + 0.05);

        return source;
    }
};

window.SoundEngine = SoundEngine;