/**
 * Pluto Attendance — Birthday Punch Chime ("Hyme") & Celebration FX
 * Recreates the complete 25-note ESP32 Happy Birthday melody (Web Audio API)
 * and rich celebratory visuals (Confetti, OLED-style celebration modal, Activity Ring glow).
 */
(function(window) {
    'use strict';

    // -------------------------------------------------------------
    // 1. Web Audio Synthesizer (Zero-latency pure JS chime synth)
    // -------------------------------------------------------------
    class BirthdayAudioSynth {
        constructor() {
            this.ctx = null;
            this.isPlaying = false;
            this.activeTimeouts = [];
        }

        initContext() {
            if (!this.ctx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    this.ctx = new AudioContextClass();
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        }

        stopMelody() {
            this.activeTimeouts.forEach(t => clearTimeout(t));
            this.activeTimeouts = [];
            this.isPlaying = false;
        }

        playTone(freq, durationMs, type = 'triangle', peakGain = 0.28) {
            this.initContext();
            if (!this.ctx || freq <= 0) return;

            try {
                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                // Gentle low-pass filter to give a warm music-box / bell timbre
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(freq * 3.5, now);

                osc.type = type;
                osc.frequency.setValueAtTime(freq, now);

                // Quick musical attack (15ms), smooth exponential decay
                const durationSec = Math.max(0.05, durationMs / 1000);
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(peakGain, now + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + durationSec + 0.05);
            } catch (err) {
                console.warn('[BirthdayFX Audio] Tone error:', err);
            }
        }

        // Standard Check-In Chirp (matches ESP32 buzzerCheckIn: 1800Hz 120ms, pause 80ms, 2400Hz 150ms)
        playCheckIn() {
            this.initContext();
            if (!this.ctx) return;
            this.playTone(1800, 120, 'sine', 0.18);
            setTimeout(() => this.playTone(2400, 150, 'sine', 0.22), 200);
        }

        // Standard Check-Out Chirp (matches ESP32 buzzerCheckOut: 1200Hz 100ms, 1800Hz 100ms, 2400Hz 150ms)
        playCheckOut() {
            this.initContext();
            if (!this.ctx) return;
            this.playTone(1200, 100, 'sine', 0.18);
            setTimeout(() => this.playTone(1800, 100, 'sine', 0.18), 150);
            setTimeout(() => this.playTone(2400, 150, 'sine', 0.22), 300);
        }

        /**
         * Complete 25-note Happy Birthday melody
         * Matches note-for-note & duration-for-duration ESP32 firmware buzzerHappyBirthday()
         */
        playHappyBirthday(onNotePlay, onComplete) {
            this.initContext();
            if (!this.ctx) {
                if (typeof onComplete === 'function') onComplete();
                return;
            }

            this.stopMelody();
            this.isPlaying = true;

            // Notes in Hz: C4=262, D4=294, E4=330, F4=349, G4=392, A4=440, Bb4=466, C5=523, 0=Rest
            const notes = [
                // Phrase 1: "Happy Birthday to you"
                262, 262, 294, 262, 349, 330, 0,
                // Phrase 2: "Happy Birthday to you"
                262, 262, 294, 262, 392, 349, 0,
                // Phrase 3: "Happy Birthday dear [Name]" (Octave jump to C5)
                262, 262, 523, 440, 349, 330, 294, 0,
                // Phrase 4: "Happy Birthday to you!" (Grand finale with Bb4)
                466, 466, 440, 349, 392, 349
            ];

            const durations = [
                // Phrase 1
                220, 200, 400, 400, 400, 700, 120,
                // Phrase 2
                220, 200, 400, 400, 400, 700, 120,
                // Phrase 3
                220, 200, 440, 400, 400, 400, 700, 120,
                // Phrase 4
                220, 200, 400, 400, 440, 900
            ];

            let offsetMs = 0;
            const articulationPause = 35; // Matches ESP32 delay(35) between notes

            notes.forEach((freq, idx) => {
                const dur = durations[idx];
                const t = setTimeout(() => {
                    if (freq > 0) {
                        this.playTone(freq, dur, 'triangle', 0.32);
                        if (typeof onNotePlay === 'function') onNotePlay(idx, freq);
                    }
                }, offsetMs);
                this.activeTimeouts.push(t);
                offsetMs += dur + articulationPause;
            });

            const finishTimeout = setTimeout(() => {
                this.isPlaying = false;
                if (typeof onComplete === 'function') onComplete();
            }, offsetMs + 250);
            this.activeTimeouts.push(finishTimeout);
        }
    }

    // -------------------------------------------------------------
    // 2. High-Performance Canvas Confetti Particle System
    // -------------------------------------------------------------
    class BirthdayConfettiCannon {
        constructor() {
            this.canvas = null;
            this.ctx = null;
            this.particles = [];
            this.animationFrame = null;
            this.colors = [
                '#fbbf24', '#f59e0b', // Gold / Amber
                '#38bdf8', '#0ea5e9', // Pluto Cyan
                '#ec4899', '#f43f5e', // Rose / Pink
                '#a855f7', '#8b5cf6', // Electric Violet
                '#10b981', '#34d399', // Emerald
                '#ffffff'             // Sparkle White
            ];
        }

        initCanvas() {
            if (!this.canvas) {
                this.canvas = document.getElementById('birthday-confetti-canvas');
                if (!this.canvas) {
                    this.canvas = document.createElement('canvas');
                    this.canvas.id = 'birthday-confetti-canvas';
                    document.body.appendChild(this.canvas);
                }
                this.ctx = this.canvas.getContext('2d');
                this.resize();
                window.addEventListener('resize', () => this.resize());
            }
        }

        resize() {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        burst(count = 140) {
            this.initCanvas();
            this.resize();

            const w = this.canvas.width;
            const h = this.canvas.height;

            // Cannon 1: Bottom-Left shooting up-right
            for (let i = 0; i < count / 2; i++) {
                this.particles.push(this.createParticle(w * 0.1, h * 0.95, 60, 25));
            }
            // Cannon 2: Bottom-Right shooting up-left
            for (let i = 0; i < count / 2; i++) {
                this.particles.push(this.createParticle(w * 0.9, h * 0.95, 120, 25));
            }
            // Center sparkle shower
            for (let i = 0; i < count / 4; i++) {
                this.particles.push(this.createParticle(w * 0.5, h * 0.8, 90, 45));
            }

            if (!this.animationFrame) {
                this.render();
            }
        }

        createParticle(originX, originY, baseAngleDeg, spreadDeg) {
            const angleRad = (baseAngleDeg + (Math.random() * spreadDeg - spreadDeg / 2)) * (Math.PI / 180);
            const speed = 12 + Math.random() * 16;
            const color = this.colors[Math.floor(Math.random() * this.colors.length)];
            const shape = Math.random() < 0.6 ? 'rect' : (Math.random() < 0.5 ? 'circle' : 'star');

            return {
                x: originX,
                y: originY,
                vx: Math.cos(angleRad) * speed * (baseAngleDeg > 90 ? -1 : 1),
                vy: -Math.abs(Math.sin(angleRad) * speed),
                size: 7 + Math.random() * 7,
                color: color,
                shape: shape,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 14,
                wobble: Math.random() * 10,
                wobbleSpeed: 0.08 + Math.random() * 0.1,
                drag: 0.965,
                gravity: 0.42,
                opacity: 1,
                decay: 0.0035 + Math.random() * 0.003
            };
        }

        render() {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];

                p.vx *= p.drag;
                p.vy = p.vy * p.drag + p.gravity;
                p.x += p.vx + Math.sin(p.wobble) * 1.5;
                p.y += p.vy;
                p.wobble += p.wobbleSpeed;
                p.rotation += p.rotationSpeed;
                p.opacity -= p.decay;

                if (p.opacity <= 0 || p.y > this.canvas.height + 40) {
                    this.particles.splice(i, 1);
                    continue;
                }

                this.ctx.save();
                this.ctx.globalAlpha = Math.max(0, p.opacity);
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate((p.rotation * Math.PI) / 180);
                this.ctx.fillStyle = p.color;

                if (p.shape === 'rect') {
                    // Fluttering rectangular ribbon
                    const scaleY = Math.cos(p.wobble);
                    this.ctx.scale(1, scaleY);
                    this.ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
                } else if (p.shape === 'circle') {
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
                    this.ctx.fill();
                } else {
                    // 4-point star sparkle
                    this.ctx.beginPath();
                    const s = p.size / 2;
                    this.ctx.moveTo(0, -s);
                    this.ctx.quadraticCurveTo(0, 0, s, 0);
                    this.ctx.quadraticCurveTo(0, 0, 0, s);
                    this.ctx.quadraticCurveTo(0, 0, -s, 0);
                    this.ctx.quadraticCurveTo(0, 0, 0, -s);
                    this.ctx.fill();
                }

                this.ctx.restore();
            }

            if (this.particles.length > 0) {
                this.animationFrame = requestAnimationFrame(() => this.render());
            } else {
                this.animationFrame = null;
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    // -------------------------------------------------------------
    // 3. Main Birthday Celebration Controller
    // -------------------------------------------------------------
    const BirthdayFX = {
        audio: new BirthdayAudioSynth(),
        confetti: new BirthdayConfettiCannon(),
        todayBirthdaysCache: [],
        currentCelebrant: null,

        init() {
            this.ensureDOMStructure();
            this.fetchTodayCelebrants();
        },

        ensureDOMStructure() {
            // 1. Confetti Canvas
            if (!document.getElementById('birthday-confetti-canvas')) {
                const canvas = document.createElement('canvas');
                canvas.id = 'birthday-confetti-canvas';
                document.body.appendChild(canvas);
            }

            // 2. Birthday Modal Overlay
            if (!document.getElementById('birthday-celebration-modal')) {
                const modal = document.createElement('div');
                modal.id = 'birthday-celebration-modal';
                modal.className = 'birthday-modal-overlay';
                modal.innerHTML = `
                    <div class="birthday-modal-card">
                        <div class="birthday-card-badge">
                            <ion-icon name="sparkles"></ion-icon>
                            <span>SPECIAL DAY • PUNCH LOGGED</span>
                            <ion-icon name="sparkles"></ion-icon>
                        </div>
                        
                        <div class="birthday-hero-animation">
                            <div class="birthday-cake-icon">🎂</div>
                            <div class="birthday-floating-elements">
                                <span class="float-item f1">🎈</span>
                                <span class="float-item f2">🎉</span>
                                <span class="float-item f3">✨</span>
                                <span class="float-item f4">🎈</span>
                            </div>
                        </div>

                        <div class="birthday-hero-tag">
                            <span>★ HAPPY BIRTHDAY! ★</span>
                        </div>

                        <h2 class="birthday-celebrant-name" id="bday-modal-name">Employee Name</h2>
                        <p class="birthday-wishes">WISHING YOU A GREAT YEAR!</p>
                        
                        <div class="birthday-audio-visualizer" id="bday-visualizer">
                            <div class="eq-bar eq-1"></div>
                            <div class="eq-bar eq-2"></div>
                            <div class="eq-bar eq-3"></div>
                            <div class="eq-bar eq-4"></div>
                            <div class="eq-bar eq-5"></div>
                            <span class="eq-label" id="bday-eq-label">Playing Birthday Tune 🎵</span>
                        </div>

                        <div class="birthday-footer-line">
                            <div class="bday-footer-left">FROM: TEAM PLUTO</div>
                            <div class="bday-footer-right">ENJOY YOUR DAY!</div>
                        </div>

                        <div class="birthday-actions">
                            <button type="button" class="btn-bday-replay" id="bday-replay-btn">
                                <ion-icon name="musical-notes-outline"></ion-icon>
                                <span>Replay Tune</span>
                            </button>
                            <button type="button" class="btn-bday-dismiss" id="bday-dismiss-btn">
                                <span>Celebrate! 🚀</span>
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                // Bind modal events
                document.getElementById('bday-dismiss-btn')?.addEventListener('click', () => {
                    this.closeModal();
                });

                document.getElementById('bday-replay-btn')?.addEventListener('click', () => {
                    this.confetti.burst(100);
                    this.playMelodyWithVisualizer();
                });

                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        this.closeModal();
                    }
                });
            }

            // 3. Birthday Banner in Employee Tab
            const punchCard = document.querySelector('#tab-attendance .punch-card');
            if (punchCard && !document.getElementById('birthday-dashboard-banner')) {
                const banner = document.createElement('div');
                banner.id = 'birthday-dashboard-banner';
                banner.className = 'birthday-dashboard-banner hidden';
                banner.innerHTML = `
                    <div class="bday-banner-content">
                        <div class="bday-banner-icon">🎂</div>
                        <div class="bday-banner-text">
                            <strong>Happy Birthday, <span id="bday-banner-name">Friend</span>! 🎉</strong>
                            <p>Wishing you an amazing year ahead from Team Pluto!</p>
                        </div>
                    </div>
                    <button type="button" class="btn-bday-banner-tune" id="bday-banner-tune-btn">
                        <ion-icon name="musical-notes"></ion-icon>
                        <span>Play Tune</span>
                    </button>
                `;
                punchCard.parentNode.insertBefore(banner, punchCard);

                document.getElementById('bday-banner-tune-btn')?.addEventListener('click', () => {
                    const userName = document.getElementById('bday-banner-name')?.textContent || 'Friend';
                    this.celebrate({ name: userName, source: 'banner' });
                });
            }
        },

        async fetchTodayCelebrants() {
            try {
                const res = await fetch('/api/birthdays');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.today)) {
                        this.todayBirthdaysCache = data.today;
                    }
                }
            } catch (err) {
                console.warn('[BirthdayFX] Could not fetch /api/birthdays:', err);
            }
        },

        isUserBirthdayToday(user) {
            if (!user) return false;
            const normEmail = (user.id || user.email || '').toLowerCase().trim();
            const normName = (user.name || '').toLowerCase().trim();

            return this.todayBirthdaysCache.some(b => {
                const bEmail = (b.email || '').toLowerCase().trim();
                const bName = (b.name || '').toLowerCase().trim();
                if (normEmail && bEmail && normEmail === bEmail) return true;
                if (normName && bName && (normName === bName || normName.includes(bName) || bName.includes(normName))) return true;
                return false;
            });
        },

        checkAndApplyUserBirthday(user) {
            if (!user) return;
            const isBday = this.isUserBirthdayToday(user);
            const banner = document.getElementById('birthday-dashboard-banner');
            const bannerName = document.getElementById('bday-banner-name');
            const ringWrapper = document.getElementById('fitness-ring-wrapper');

            if (isBday) {
                const firstName = (user.name || 'Friend').split(' ')[0];
                if (banner && bannerName) {
                    bannerName.textContent = firstName;
                    banner.classList.remove('hidden');
                }
                if (ringWrapper) {
                    ringWrapper.classList.add('ring-birthday');
                }
            } else {
                if (banner) banner.classList.add('hidden');
                if (ringWrapper) ringWrapper.classList.remove('ring-birthday');
            }
        },

        playCheckInSound() {
            this.audio.playCheckIn();
        },

        playCheckOutSound() {
            this.audio.playCheckOut();
        },

        playMelodyWithVisualizer() {
            const visualizer = document.getElementById('bday-visualizer');
            const eqLabel = document.getElementById('bday-eq-label');

            if (visualizer) visualizer.classList.remove('paused');
            if (eqLabel) eqLabel.textContent = 'Playing Birthday Tune 🎵';

            this.audio.playHappyBirthday(
                null, // onNotePlay
                () => { // onComplete
                    if (visualizer) visualizer.classList.add('paused');
                    if (eqLabel) eqLabel.textContent = 'Tune Completed ✨';
                }
            );
        },

        /**
         * Main trigger for birthday punch-in celebration
         */
        celebrate({ name = 'Celebrant', source = 'punch_in' } = {}) {
            this.ensureDOMStructure();
            this.currentCelebrant = name;

            // 1. Update Modal Content
            const nameEl = document.getElementById('bday-modal-name');
            if (nameEl) nameEl.textContent = name;

            // 2. Open Modal
            const modal = document.getElementById('birthday-celebration-modal');
            if (modal) modal.classList.add('active');

            // 3. Highlight Activity Ring
            const ringWrapper = document.getElementById('fitness-ring-wrapper');
            if (ringWrapper) ringWrapper.classList.add('ring-birthday');

            // 4. Fire Cannon Blast
            this.confetti.burst(150);
            setTimeout(() => this.confetti.burst(80), 900);

            // 5. Play Birthday Melody
            this.playMelodyWithVisualizer();
        },

        closeModal() {
            const modal = document.getElementById('birthday-celebration-modal');
            if (modal) modal.classList.remove('active');
            this.audio.stopMelody();
        }
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => BirthdayFX.init());
    } else {
        BirthdayFX.init();
    }

    window.BirthdayFX = BirthdayFX;
})(window);
