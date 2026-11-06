(async () => {
  const status = document.getElementById('status'),
    list = document.getElementById('results');
  try {
    const response = await fetch('./deployment-manifest.json', {
      cache: 'no-store'
    });
    if (!response.ok)
      throw Error(
        'The deployment manifest is missing. Upload the complete latest dist folder.'
      );
    const files = await response.json();
    let done = 0,
      failed = 0;
    for (let i = 0; i < files.length; i += 4)
      await Promise.all(
        files.slice(i, i + 4).map(async (file) => {
          let issue = '';
          try {
            const r = await fetch('./' + file.path, { cache: 'no-store' });
            if (!r.ok) throw Error('HTTP ' + r.status);
            const data = await r.arrayBuffer();
            if (data.byteLength !== file.bytes)
              issue = 'File size differs: incomplete or older upload';
            else if (crypto.subtle) {
              const hash = [
                ...new Uint8Array(await crypto.subtle.digest('SHA-256', data))
              ]
                .map((n) => n.toString(16).padStart(2, '0'))
                .join('');
              if (hash !== file.sha256) issue = 'Different version uploaded';
            }
          } catch (e) {
            issue = e.message;
          }
          if (issue) {
            failed++;
            const li = document.createElement('li');
            li.textContent = file.path + ' — ' + issue;
            list.append(li);
          }
          done++;
          status.textContent = `Checked ${done}/${files.length} files`;
        })
      );
    status.textContent = failed
      ? `${failed} file(s) need to be uploaded again.`
      : 'All scene files match this release. If the scene still fails, copy its full error details.';
  } catch (e) {
    status.textContent = e.message;
  }
})();
