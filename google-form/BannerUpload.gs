/**
 * Banner upload form -> GitHub (vrc-banners).
 *
 * Paste into the form's script editor (Form editor > three dots > Apps Script), then:
 *   1. Project Settings > Script Properties, add:
 *        OWNER_EMAIL   the Google account allowed to submit (yours)
 *        GITHUB_TOKEN  fine-grained token: only the banner repo, "Contents: Read and write"
 *        GITHUB_REPO   Maxii-VR/vrc-banners
 *   2. Run install() once and accept the permissions.
 *
 * Every submission from OWNER_EMAIL becomes ONE commit (image + slots.json). GitHub then packs
 * the atlases and publishes them; players joining ~1-10 min later see the change.
 * Submissions from anyone else are ignored. Failures are emailed to OWNER_EMAIL.
 *
 * The form needs (titles must match QUESTIONS below):
 *   Slot               dropdown 1..24, required
 *   Action             multiple choice: Upload / replace | Turn ON | Turn OFF
 *   Banner image       file upload, optional (needed for Upload / replace)
 *   Seconds on screen  short answer, optional
 *   Name               short answer, optional
 * Settings > Responses > Collect email addresses: "Verified".
 */
const QUESTIONS = {
  slot: 'Slot',
  action: 'Action',
  image: 'Banner image',
  seconds: 'Seconds on screen',
  name: 'Name',
};
const BRANCH = 'main';

function install() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSubmit').forForm(FormApp.getActiveForm()).onFormSubmit().create();
  // Touch the services once so the permission prompt covers them all.
  DriveApp.getRootFolder();
  UrlFetchApp.getRequest('https://api.github.com');
  MailApp.getRemainingDailyQuota();
  console.log('Installed. Submissions now go to ' + prop('GITHUB_REPO'));
}

function onSubmit(e) {
  const owner = prop('OWNER_EMAIL').toLowerCase();
  const who = (e.response.getRespondentEmail() || '').toLowerCase();
  if (who !== owner) {
    console.warn('Ignored a submission from "' + who + '"');
    return;
  }
  try {
    const msg = apply(read(e.response));
    console.log(msg);
  } catch (err) {
    MailApp.sendEmail(owner, 'Banner upload failed', String(err && err.stack || err));
    throw err;
  }
}

/** Form answers by question title. */
function read(response) {
  const a = {};
  response.getItemResponses().forEach(r => {
    const title = r.getItem().getTitle().trim();
    for (const key in QUESTIONS) if (QUESTIONS[key] === title) a[key] = r.getResponse();
  });
  const slot = parseInt(a.slot, 10);
  if (!(slot >= 1 && slot <= 99)) throw new Error('Bad slot: ' + a.slot);
  const action = String(a.action || 'Upload').toLowerCase();
  return {
    slot: slot,
    mode: action.indexOf('off') >= 0 ? 'off' : action.indexOf('on') >= 0 && action.indexOf('upload') < 0 ? 'on' : 'upload',
    fileId: Array.isArray(a.image) && a.image.length ? a.image[0] : null,
    seconds: a.seconds ? parseFloat(String(a.seconds).replace(',', '.')) : null,
    name: a.name ? String(a.name).trim() : null,
  };
}

function apply(req) {
  const head = gh('/git/ref/heads/' + BRANCH);
  const parent = gh('/git/commits/' + head.object.sha);

  const file = gh('/contents/slots.json?ref=' + head.object.sha);
  const cfg = JSON.parse(Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));
  let s = cfg.slots.filter(x => x.slot === req.slot)[0];
  if (!s) {
    s = { slot: req.slot, name: '', image: '', on: false, seconds: 8 };
    cfg.slots.push(s);
    cfg.slots.sort((x, y) => x.slot - y.slot);
  }

  const tree = [];
  let what;
  if (req.mode === 'upload') {
    if (!req.fileId) throw new Error('Upload / replace needs an image.');
    const blob = DriveApp.getFileById(req.fileId).getBlob();
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.getContentType()];
    if (!ext) throw new Error('Unsupported image type ' + blob.getContentType() + ' (use PNG or JPG).');
    const path = 'banners/slot_' + ('0' + req.slot).slice(-2) + '.' + ext;
    const b = gh('/git/blobs', 'post', { content: Utilities.base64Encode(blob.getBytes()), encoding: 'base64' });
    tree.push({ path: path, mode: '100644', type: 'blob', sha: b.sha });
    s.image = path;
    s.on = true;
    what = 'Upload slot ' + req.slot;
  } else {
    if (req.mode === 'on' && !s.image) throw new Error('Slot ' + req.slot + ' has no image yet.');
    s.on = req.mode === 'on';
    what = 'Turn slot ' + req.slot + (s.on ? ' on' : ' off');
  }
  if (req.seconds && req.seconds >= 2 && req.seconds <= 120) s.seconds = req.seconds;
  if (req.name) s.name = req.name;

  const cfgBlob = gh('/git/blobs', 'post', { content: JSON.stringify(cfg, null, 1) + '\n', encoding: 'utf-8' });
  tree.push({ path: 'slots.json', mode: '100644', type: 'blob', sha: cfgBlob.sha });

  const newTree = gh('/git/trees', 'post', { base_tree: parent.tree.sha, tree: tree });
  const commit = gh('/git/commits', 'post', {
    message: what + (s.name ? ' (' + s.name + ')' : '') + ' [form]',
    tree: newTree.sha,
    parents: [head.object.sha],
  });
  gh('/git/refs/heads/' + BRANCH, 'patch', { sha: commit.sha });
  return what + ' -> ' + commit.sha.slice(0, 7);
}

function gh(path, method, body) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + prop('GITHUB_REPO') + path, {
    method: method || 'get',
    contentType: 'application/json',
    payload: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: 'Bearer ' + prop('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('GitHub ' + (method || 'get').toUpperCase() + ' ' + path + ' -> ' + code + ': ' + res.getContentText().slice(0, 400));
  return JSON.parse(res.getContentText());
}

function prop(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Script property ' + name + ' is not set.');
  return v;
}
