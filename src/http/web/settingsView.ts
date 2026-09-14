import type { Doctor } from '@prisma/client';
import { c } from '../../i18n/console';
import { html, page, raw } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';
import { bookingLink, qrSvg } from './qr';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function windowsFor(workingHours: unknown, day: string): string {
  if (!workingHours || typeof workingHours !== 'object') return '';
  const value = (workingHours as Record<string, unknown>)[day];
  if (!Array.isArray(value)) return '';
  return value
    .filter((w): w is { start: string; end: string } => !!w && typeof w === 'object')
    .map((w) => `${String(w.start)}–${String(w.end)}`)
    .join(', ');
}

/**
 * Downscales the chosen image in the browser to a 256px square and hands the
 * result to the form as a data: URI.
 *
 * Doing it client-side avoids a multipart parser and an image library, and it
 * bounds the payload regardless of what the doctor picks — a 6MB phone photo
 * arrives as a few KB. The server still validates type and size: this script
 * is convenience, not a control.
 */
const PHOTO_SCRIPT = `
(function(){
  var file=document.getElementById('photoFile');
  var data=document.getElementById('photoData');
  var prev=document.getElementById('photoPreview');
  var drop=document.getElementById('photoRemove');
  if(!file||!data) return;

  file.addEventListener('change',function(){
    var f=file.files&&file.files[0];
    if(!f) return;
    if(!/^image\\/(jpeg|png|webp)$/.test(f.type)){
      alert('Please choose a JPG, PNG or WebP image.');
      file.value=''; return;
    }
    var reader=new FileReader();
    reader.onload=function(){
      var img=new Image();
      img.onload=function(){
        var S=256, c=document.createElement('canvas');
        c.width=S; c.height=S;
        var ctx=c.getContext('2d');
        // Cover-crop to a square so faces are not squashed.
        var side=Math.min(img.width,img.height);
        ctx.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,S,S);
        var out=c.toDataURL('image/jpeg',0.82);
        data.value=out;
        if(prev){ prev.src=out; prev.style.display='block'; }
        var ini=document.getElementById('photoInitials');
        if(ini) ini.style.display='none';
        if(drop) drop.checked=false;
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(f);
  });
})();
`;

/**
 * Profile is editable by the doctor; booking configuration below it is not.
 * The split is deliberate: identity is theirs, but token cap and consult length
 * change the wait times patients were already quoted, so those stay with the
 * operator.
 */
export function settingsPage(opts: {
  doctor: Doctor;
  queueCount: number;
  csrfToken: string;
  flash?: string;
  error?: string;
}): string {
  const { doctor } = opts;
  const s = c(doctor.defaultLanguage);
  const navOpts = {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    // Settings sits outside the four tabs, so nothing is marked current.
    current: 'queue' as const,
    queueCount: opts.queueCount,
    csrfToken: opts.csrfToken,
    s,
    photo: opts.doctor.photo,
    specialty: opts.doctor.specialty,
    bookingMode: opts.doctor.bookingMode,
  };
  const link = doctor.whatsappNumber ? bookingLink(doctor.whatsappNumber) : null;

  return page(
    { title: s.settings, csrfToken: opts.csrfToken },
    html`
      ${doctorHeader(navOpts)}
      <main>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}

        <div class="card">
          <h2>${s.profile}</h2>
          <p class="sub">${s.profileSub}</p>

          <form method="post" action="/app/settings/profile">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <input type="hidden" name="photo" id="photoData" value="" />

            <div class="photorow">
              <div class="photobox">
                <img
                  id="photoPreview"
                  class="photo"
                  src="${doctor.photo ?? ''}"
                  alt=""
                  style="${doctor.photo ? '' : 'display:none'}"
                />
                <span id="photoInitials" class="avatar lg" style="${doctor.photo ? 'display:none' : ''}"
                  >${initials(doctor.name)}</span
                >
              </div>
              <div style="min-width:0">
                <label for="photoFile">${s.photoLabel}</label>
                <input id="photoFile" name="photoFile" type="file" accept="image/jpeg,image/png,image/webp" />
                <p class="hint">${s.photoHint}</p>
                ${doctor.photo
                  ? html`<label class="checkline"
                      ><input type="checkbox" id="photoRemove" name="removePhoto" value="1" />
                      ${s.removePhoto}</label
                    >`
                  : ''}
              </div>
            </div>

            <div class="row">
              <div>
                <label for="name">${s.doctorNameLabel}</label>
                <input id="name" name="name" type="text" value="${doctor.name}" required />
              </div>
              <div>
                <label for="clinicName">${s.clinicNameLabel}</label>
                <input
                  id="clinicName"
                  name="clinicName"
                  type="text"
                  value="${doctor.clinicName}"
                  required
                />
              </div>
            </div>

            <div class="row">
              <div>
                <label for="specialty">${s.specialtyLabel}</label>
                <input
                  id="specialty"
                  name="specialty"
                  type="text"
                  value="${doctor.specialty ?? ''}"
                  placeholder="General Physician"
                />
              </div>
              <div>
                <label for="qualification">${s.qualificationLabel}</label>
                <input
                  id="qualification"
                  name="qualification"
                  type="text"
                  value="${doctor.qualification ?? ''}"
                  placeholder="MBBS, MD"
                />
              </div>
            </div>

            <button type="submit">${s.saveProfile}</button>
          </form>
        </div>

        <div class="card">
          <h2>${s.clinicDetails}</h2>
          <table>
            <tbody>
              <tr><th>Phone</th><td class="num">${doctor.phone}</td></tr>
              <tr><th>${s.timezoneLabel}</th><td>${doctor.timezone}</td></tr>
              <tr>
                <th>${s.languageLabel}</th>
                <td>${doctor.defaultLanguage === 'KN' ? 'ಕನ್ನಡ' : 'English'}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">${s.changesViaAdmin}</p>
        </div>

        <div class="card">
          <h2>${s.bookingConfig}</h2>
          <table>
            <tbody>
              <tr><th>Mode</th><td>${doctor.bookingMode}</td></tr>
              <tr><th>${s.dailyCap}</th><td class="num">${doctor.dailyTokenCap}</td></tr>
              <tr><th>${s.consultLength}</th><td class="num">${doctor.consultDurationMins} min</td></tr>
              <tr>
                <th>${s.learnedAverage}</th>
                <td class="num">
                  ${doctor.avgConsultTimeMins.toFixed(1)} min
                  <div class="hint">
                    from ${doctor.consultSampleCount}
                    consult${doctor.consultSampleCount === 1 ? '' : 's'} — this drives the wait
                    times patients are told
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="hint">${s.changesViaAdmin}</p>
        </div>

        <div class="card">
          <h2>${s.workingHours}</h2>
          <table>
            <tbody>
              ${DAYS.map((day) => {
                const windows = windowsFor(doctor.workingHours, day);
                return html`<tr>
                  <th>${DAY_LABELS[day]}</th>
                  <td class="num">
                    ${windows ? windows : html`<span class="muted">${s.closedDay}</span>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>

        ${link
          ? html`
              <div class="card">
                <h2>${s.scanToBook}</h2>
                <p class="sub">${s.noBookingsBody}</p>
                <div style="text-align:center">
                  <div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
                  <div>
                    <a class="walink" href="${link}" target="_blank" rel="noopener"
                      >+${doctor.whatsappNumber}</a
                    >
                  </div>
                </div>
              </div>
            `
          : ''}
      </main>
      ${doctorBottomNav(navOpts)}
    `,
    html`<script>
      ${raw(PHOTO_SCRIPT)}
    </script>`,
  );
}
