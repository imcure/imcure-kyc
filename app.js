/**
 * app.js — IMCure KYC Final
 * Files → Google Drive via Apps Script
 * Metadata → Firestore
 */

'use strict';

// ── Apps Script Web App URL ───────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz347hDcC3YoipWjoReESIftY8ug2E-6WlvzLeqI2ZbfXQpTPMsoKqfJ5fb5k7hcS3YzQ/exec';

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
const State = {
  currentStep: 1,
  userId:      null,
  kycId:       null,
  fullName:    '',
  phone:       '',
  confirmationResult: null,
  idFile:      null,
  videoBlob:   null,
  consentGiven: false,
  idDriveLink:    null,
  videoDriveLink: null,
};

let mediaStream      = null;
let mediaRecorder    = null;
let recordedChunks   = [];
let recordingTimer   = null;
let recordingSeconds = 0;
let countdownInterval = null;

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  State.userId = params.get('user_id') || generateId('USR');
  State.kycId  = generateKycId();
  setupRecaptcha();
  setupDragDrop();
});

/* ══════════════════════════════════════════════════════
   STEP NAVIGATION
══════════════════════════════════════════════════════ */
function goToStep(nextStep) {
  document.getElementById(`step${State.currentStep}`)?.classList.remove('active');
  updateStepper(nextStep);
  State.currentStep = nextStep;
  const id = nextStep === 'success' ? 'stepSuccess' : `step${nextStep}`;
  document.getElementById(id)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper(activeStep) {
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    const n = i + 1;
    dot.classList.remove('active', 'done');
    if (n < activeStep) { dot.classList.add('done'); dot.querySelector('.dot-inner').textContent = '✓'; }
    else if (n === activeStep) { dot.classList.add('active'); dot.querySelector('.dot-inner').textContent = n; }
    else { dot.querySelector('.dot-inner').textContent = n; }
  });
  document.querySelectorAll('.step-line').forEach((line, i) => {
    i + 1 < activeStep ? line.classList.add('done') : line.classList.remove('done');
  });
  if (activeStep === 'success') document.getElementById('progressWrap').style.display = 'none';
}

/* ══════════════════════════════════════════════════════
   STEP 1 — DETAILS
══════════════════════════════════════════════════════ */
function handleStep1() {
  const name  = document.getElementById('fullName').value.trim();
  const phone = document.getElementById('phoneNumber').value.trim();
  clearErrors('nameError', 'phoneError');
  let valid = true;
  if (!name || name.length < 3) { showError('nameError', 'Please enter your full name (min. 3 characters).'); valid = false; }
  if (!/^\d{10}$/.test(phone))  { showError('phoneError', 'Please enter a valid 10-digit mobile number.'); valid = false; }
  if (!valid) return;
  State.fullName = name;
  State.phone    = '+91' + phone;
  sendOTP();
}

/* ══════════════════════════════════════════════════════
   FIREBASE OTP
══════════════════════════════════════════════════════ */
function setupRecaptcha() {
  try {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible',
      callback: () => {},
      'expired-callback': () => showToast('reCAPTCHA expired. Try again.', 'error')
    });
  } catch(e) { console.error(e); }
}

function sendOTP() {
  setLoading('btnStep1', true);
  auth.signInWithPhoneNumber(State.phone, window.recaptchaVerifier)
    .then(result => {
      State.confirmationResult = result;
      setLoading('btnStep1', false);
      showToast(`OTP sent to ${State.phone}`, 'success');
      document.getElementById('otpSentMsg').textContent =
        `OTP sent to +91 ${document.getElementById('phoneNumber').value.trim()}.`;
      goToStep(2);
      startResendCountdown();
    })
    .catch(err => {
      setLoading('btnStep1', false);
      showError('phoneError', getFirebaseErrorMessage(err.code));
      window.recaptchaVerifier?.render().then(id => grecaptcha.reset(id)).catch(() => {});
    });
}

function handleOTPVerify() {
  const otp = document.getElementById('otpInput').value.trim();
  clearErrors('otpError');
  if (!/^\d{6}$/.test(otp)) { showError('otpError', 'Please enter the 6-digit OTP.'); return; }
  if (!State.confirmationResult) { showError('otpError', 'Session expired. Please resend OTP.'); return; }
  setLoading('btnVerifyOtp', true);
  State.confirmationResult.confirm(otp)
    .then(() => {
      setLoading('btnVerifyOtp', false);
      clearInterval(countdownInterval);
      showToast('Phone verified!', 'success');
      goToStep(3);
    })
    .catch(err => {
      setLoading('btnVerifyOtp', false);
      showError('otpError', getFirebaseErrorMessage(err.code));
    });
}

function resendOTP() {
  document.getElementById('resendBtn').classList.add('hidden');
  document.getElementById('resendTimer').classList.remove('hidden');
  setupRecaptcha();
  sendOTP();
  startResendCountdown();
}

function startResendCountdown() {
  let s = 30;
  document.getElementById('countdown').textContent = s;
  document.getElementById('resendTimer').classList.remove('hidden');
  document.getElementById('resendBtn').classList.add('hidden');
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    s--;
    document.getElementById('countdown').textContent = s;
    if (s <= 0) {
      clearInterval(countdownInterval);
      document.getElementById('resendTimer').classList.add('hidden');
      document.getElementById('resendBtn').classList.remove('hidden');
    }
  }, 1000);
}

/* ══════════════════════════════════════════════════════
   STEP 3 — ID UPLOAD
══════════════════════════════════════════════════════ */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  clearErrors('fileError');
  if (!['image/jpeg','image/png','application/pdf'].includes(file.type)) {
    showError('fileError', 'Only JPG, PNG or PDF files are accepted.'); return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError('fileError', 'File size must not exceed 5MB.'); return;
  }
  State.idFile = file;
  document.getElementById('filePreview').classList.remove('hidden');
  document.getElementById('uploadZone').classList.add('hidden');
  if (file.type === 'application/pdf') {
    document.getElementById('previewImg').classList.add('hidden');
    document.getElementById('previewPdf').classList.remove('hidden');
    document.getElementById('pdfName').textContent = file.name;
  } else {
    document.getElementById('previewPdf').classList.add('hidden');
    document.getElementById('previewImg').classList.remove('hidden');
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('previewImg').src = e.target.result; };
    reader.readAsDataURL(file);
  }
}

function removeFile() {
  State.idFile = null;
  document.getElementById('idFileInput').value = '';
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('previewImg').classList.add('hidden');
  document.getElementById('previewPdf').classList.add('hidden');
  document.getElementById('uploadZone').classList.remove('hidden');
  clearErrors('fileError');
}

function handleStep3() {
  clearErrors('fileError');
  if (!State.idFile) { showError('fileError', 'Please upload your ID proof document.'); return; }
  goToStep(4);
}

function setupDragDrop() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });
}

/* ══════════════════════════════════════════════════════
   STEP 4 — VIDEO RECORDING
══════════════════════════════════════════════════════ */
async function startCamera() {
  clearErrors('videoError');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    const liveVideo = document.getElementById('liveVideo');
    liveVideo.srcObject = mediaStream;
    liveVideo.classList.remove('hidden');
    document.getElementById('previewVideo').classList.add('hidden');
    document.getElementById('btnStartCamera').classList.add('hidden');
    document.getElementById('btnRecord').classList.remove('hidden');
    document.getElementById('btnStep4').classList.add('hidden');
    document.getElementById('btnReRecord').classList.add('hidden');
    showToast('Camera ready!', 'success');
  } catch(err) {
    showError('videoError', 'Could not access camera/microphone. Please allow permissions.');
  }
}

function toggleRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') startRecording();
  else stopRecording();
}

function startRecording() {
  recordedChunks = []; recordingSeconds = 0;
  const mimeType = getSupportedMimeType();
  try { mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {}); }
  catch { mediaRecorder = new MediaRecorder(mediaStream); }
  mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(1000);
  document.getElementById('btnRecord').classList.add('recording');
  document.getElementById('recordBtnText').textContent = '■ Stop Recording';
  document.getElementById('recIndicator').classList.remove('hidden');
  document.getElementById('recTimerDisplay').classList.remove('hidden');
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    const m = Math.floor(recordingSeconds / 60), s = recordingSeconds % 60;
    document.getElementById('recTimerDisplay').textContent = `${m}:${String(s).padStart(2,'0')}`;
    if (recordingSeconds >= 15) { showToast('Max recording time reached.'); stopRecording(); }
  }, 1000);
}

function stopRecording() {
  clearInterval(recordingTimer);
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  document.getElementById('btnRecord').classList.remove('recording');
  document.getElementById('recordBtnText').textContent = '● Start Recording';
  document.getElementById('recIndicator').classList.add('hidden');
  document.getElementById('recTimerDisplay').classList.add('hidden');
}

function onRecordingStop() {
  if (recordingSeconds < 3) {
    showError('videoError', 'Recording too short. Please record at least 3 seconds.');
    reRecord(); return;
  }
  const mimeType  = getSupportedMimeType() || 'video/webm';
  State.videoBlob = new Blob(recordedChunks, { type: mimeType });
  const preview   = document.getElementById('previewVideo');
  preview.src     = URL.createObjectURL(State.videoBlob);
  preview.classList.remove('hidden');
  document.getElementById('liveVideo').classList.add('hidden');
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  document.getElementById('btnRecord').classList.add('hidden');
  document.getElementById('btnReRecord').classList.remove('hidden');
  document.getElementById('btnStep4').classList.remove('hidden');
  showToast('Video recorded! Review below.', 'success');
}

function reRecord() {
  State.videoBlob = null; recordedChunks = [];
  document.getElementById('previewVideo').classList.add('hidden');
  document.getElementById('previewVideo').src = '';
  document.getElementById('liveVideo').classList.remove('hidden');
  document.getElementById('btnReRecord').classList.add('hidden');
  document.getElementById('btnStep4').classList.add('hidden');
  document.getElementById('btnRecord').classList.remove('hidden');
  document.getElementById('btnStartCamera').classList.add('hidden');
  clearErrors('videoError');
  startCamera();
}

function getSupportedMimeType() {
  const types = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function handleStep4() {
  clearErrors('videoError');
  if (!State.videoBlob) { showError('videoError', 'Please record a video before continuing.'); return; }
  document.getElementById('summaryName').textContent  = State.fullName;
  document.getElementById('summaryPhone').textContent = State.phone;
  document.getElementById('summaryFile').textContent  = State.idFile?.name || '—';
  document.getElementById('summaryVideo').textContent = `Video (${formatBytes(State.videoBlob.size)})`;
  document.getElementById('summaryKycId').textContent = State.kycId;
  goToStep(5);
}

/* ══════════════════════════════════════════════════════
   STEP 5 — CONSENT
══════════════════════════════════════════════════════ */
function toggleConsentStyle() {
  const check = document.getElementById('consentCheck');
  State.consentGiven = check.checked;
  document.getElementById('consentLabel').classList.toggle('checked', check.checked);
}

/* ══════════════════════════════════════════════════════
   SUBMIT — Drive + Firestore
══════════════════════════════════════════════════════ */
async function handleSubmit() {
  clearErrors('consentError');
  if (!State.consentGiven) { showError('consentError', 'You must give consent to proceed.'); return; }
  setLoading('btnSubmit', true);

  try {
    const { userId, kycId, fullName } = State;
    const safeName = fullName.replace(/\s+/g, '_');

    // 1. Upload ID to Drive
    showToast('Uploading ID document…');
    const idExt      = getFileExtension(State.idFile.name);
    const idFileName = `${kycId}_ID_${safeName}.${idExt}`;
    const idBase64   = await fileToBase64(State.idFile);
    const idResult   = await uploadToDrive(idBase64, idFileName, State.idFile.type);
    State.idDriveLink = idResult.webViewLink;

    // 2. Upload Video to Drive
    showToast('Uploading video…');
    const videoFileName = `${kycId}_VIDEO_${safeName}.webm`;
    const videoBase64   = await blobToBase64(State.videoBlob);
    const videoResult   = await uploadToDrive(videoBase64, videoFileName, 'video/webm');
    State.videoDriveLink = videoResult.webViewLink;

    // 3. Save to Firestore
    showToast('Saving your record…');
    await db.collection('kyc_submissions').doc(kycId).set({
      kycId, userId,
      name:          fullName,
      phone:         State.phone,
      timestamp:     firebase.firestore.FieldValue.serverTimestamp(),
      status:        'pending',
      consentGiven:  true,
      idFileName,
      idDriveLink:   State.idDriveLink,
      videoFileName,
      videoDriveLink: State.videoDriveLink,
    });

    setLoading('btnSubmit', false);
    document.getElementById('finalKycId').textContent = kycId;
    goToStep('success');

  } catch(error) {
    setLoading('btnSubmit', false);
    console.error('[Submit error]', error);
    showToast(`Upload failed: ${error.message}. Please retry.`, 'error');
  }
}

/* ══════════════════════════════════════════════════════
   GOOGLE DRIVE UPLOAD via Apps Script
══════════════════════════════════════════════════════ */
async function uploadToDrive(base64Data, fileName, mimeType) {
  const formData = new FormData();
  formData.append('fileName',   fileName);
  formData.append('mimeType',   mimeType);
  formData.append('fileBase64', base64Data);

  // Apps Script requires no-cors for FormData OR we use fetch with JSON
  const response = await fetch(APPS_SCRIPT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fileName, mimeType, fileBase64: base64Data }),
  });

  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('Invalid response from upload server.'); }
  if (!result.success) throw new Error(result.error || 'Upload failed.');
  return result;
}

/* ══════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════ */
function generateKycId() {
  return `KYC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2,7).toUpperCase()}`;
}
function generateId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
function getFileExtension(filename) { return filename.split('.').pop().toLowerCase(); }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)}KB`;
  return `${(bytes/1048576).toFixed(1)}MB`;
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function showError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function clearErrors(...ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; }); }
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
  btn.querySelector('.btn-loader')?.classList.toggle('hidden', !loading);
}
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast show${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 3200);
}
function getFirebaseErrorMessage(code) {
  const m = {
    'auth/invalid-phone-number':      'Invalid phone number.',
    'auth/too-many-requests':         'Too many attempts. Wait a few minutes.',
    'auth/invalid-verification-code': 'Incorrect OTP. Please try again.',
    'auth/code-expired':              'OTP expired. Please request a new one.',
    'auth/quota-exceeded':            'SMS quota exceeded. Try again later.',
    'auth/network-request-failed':    'Network error. Check your connection.',
  };
  return m[code] || `Error (${code}). Please try again.`;
}
