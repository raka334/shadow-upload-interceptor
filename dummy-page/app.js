const input = document.querySelector('[data-forge-upload]');
const dropZone = document.querySelector('#forge-drop-zone');
const statusCard = document.querySelector('.status-card');
const statusTitle = document.querySelector('#status-title');
const statusDetail = document.querySelector('#status-detail');
const received = document.querySelector('#received-file');
const receivedName = document.querySelector('#received-name');
const receivedSize = document.querySelector('#received-size');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(status, title, detail) {
  statusCard.dataset.status = status;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function acceptFile(file) {
  if (!file) return;
  receivedName.textContent = file.name;
  receivedSize.textContent = formatBytes(file.size);
  received.hidden = false;
  setStatus('allowed', 'Allowed — uploaded', `${file.name} was received by Forge.`);
}

input.addEventListener('change', () => acceptFile(input.files?.[0]));

dropZone.addEventListener('dragenter', () => dropZone.classList.add('is-dragging'));
dropZone.addEventListener('dragleave', (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
});
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

window.addEventListener('secureintent:status', (event) => {
  const { state, filename, detail } = event.detail ?? {};
  dropZone.classList.remove('is-dragging');
  if (state === 'scanning') {
    received.hidden = true;
    setStatus('scanning', 'Scanning locally…', `${filename} has not been sent to Forge.`);
  }
  if (state === 'blocked') {
    received.hidden = true;
    setStatus('blocked', 'Blocked — not sent', `${filename} was stopped before Forge received it.`);
  }
  if (state === 'allowed' && detail) {
    statusDetail.textContent = detail;
  }
});
