const button = document.querySelector('#copy-command');
button?.addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#install-command').textContent);
    button.textContent = 'Copied';
    status.textContent = 'Repository link copied.';
    setTimeout(() => { button.textContent = 'Copy'; status.textContent = ''; }, 3000);
  } catch {
    status.textContent = 'Select the two commands above and copy them manually.';
  }
});
