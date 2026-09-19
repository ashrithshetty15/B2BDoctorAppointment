import type { Doctor } from '@prisma/client';
import { type ConsoleStrings, c } from '../../i18n/console';
import { type DayKey, DAY_KEYS } from '../../domain/slots';
import { html, initials, page, raw } from './layout';
import { doctorBottomNav, doctorHeader, type ConsoleDoctor } from './nav';
import { bookingLink, qrSvg } from './qr';

/** Weekday names are translated now; they used to be hardcoded English here. */
function dayLabel(s: ConsoleStrings, day: DayKey): string {
  const byDay: Record<DayKey, string> = {
    mon: s.dayMon,
    tue: s.dayTue,
    wed: s.dayWed,
    thu: s.dayThu,
    fri: s.dayFri,
    sat: s.daySat,
    sun: s.daySun,
  };
  return byDay[day];
}

/** One closed day in the Time off list. */
export interface LeaveDay {
  /** YYYY-MM-DD, the value posted back. */
  iso: string;
  /** Human form, already localised by the caller. */
  label: string;
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
  doctor: ConsoleDoctor;
  queueCount: number;
  csrfToken: string;
  /** Working hours as editable text, one field per day. */
  hours: Record<DayKey, string>;
  upcomingLeave: LeaveDay[];
  /** Path to this doctor's waiting-room board, e.g. /display/scr_a1b2... */
  displayPath: string;
  /** Dialable number for the QR — the clinic's, not the doctor's own. */
  bookingNumber: string | null;
  /** Today in the clinic's timezone, YYYY-MM-DD — the date picker's floor. */
  today: string;
  flash?: string;
  error?: string;
  /** A malformed hours entry, e.g. "Monday: 25:00-26:00 must use 24-hour HH:MM times". */
  hoursError?: string;
  /** Bookings that the submitted hours would strand, already formatted. */
  hoursClash?: string[];
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
    ...(doctor.clinicDoctors ? { clinicDoctors: doctor.clinicDoctors } : {}),
  };
  const link = opts.bookingNumber ? bookingLink(opts.bookingNumber) : null;

  return page(
    { title: s.settings, csrfToken: opts.csrfToken, bare: true },
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
          <dl class="kv">
            <dt>Phone</dt><dd class="num">${doctor.phone}</dd>
            <dt>${s.timezoneLabel}</dt><dd>${doctor.timezone}</dd>
            <dt>${s.languageLabel}</dt>
            <dd>${doctor.defaultLanguage === 'KN' ? 'ಕನ್ನಡ' : 'English'}</dd>
          </dl>
          <p class="hint">${s.changesViaAdmin}</p>
        </div>

        <div class="card">
          <h2>${s.bookingConfig}</h2>
          <div class="stats">
            <div class="s">
              <div class="n">${doctor.dailyTokenCap}</div>
              <div class="l">${s.dailyCap}</div>
            </div>
            <div class="s">
              <div class="n">${doctor.consultDurationMins} min</div>
              <div class="l">${s.consultLength}</div>
            </div>
            <div class="s">
              <div class="n">${doctor.avgConsultTimeMins.toFixed(1)} min</div>
              <div class="l">${s.learnedAverage}</div>
            </div>
          </div>
          <p class="hint">
            The learned average comes from ${doctor.consultSampleCount}
            consult${doctor.consultSampleCount === 1 ? '' : 's'} and is what decides the wait
            times patients are quoted. ${s.changesViaAdmin}
          </p>
        </div>

        <div class="card">
          <h2>${s.workingHours}</h2>
          <p class="sub">${s.hoursHint}</p>

          ${opts.hoursError
            ? html`<div class="err">${opts.hoursError}</div>`
            : ''}
          ${opts.hoursClash && opts.hoursClash.length > 0
            ? html`
                <div class="err">
                  <strong>${s.hoursClashTitle}</strong>
                  <ul class="clash">
                    ${opts.hoursClash.map((cl) => html`<li>${cl}</li>`)}
                  </ul>
                  ${s.hoursClashBody}
                </div>
              `
            : ''}

          <form method="post" action="/app/settings/hours">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            ${DAY_KEYS.map(
              (day) => html`
                <label for="hours_${day}">${dayLabel(s, day)}</label>
                <input
                  id="hours_${day}"
                  name="hours_${day}"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  value="${opts.hours[day] ?? ''}"
                  placeholder="${s.closedDay}"
                />
              `,
            )}
            <p class="hint">${s.hoursExample}</p>
            <button type="submit">${s.saveHours}</button>
          </form>
        </div>

        <div class="card">
          <h2>${s.timeOff}</h2>
          <p class="sub">${s.timeOffSub}</p>

          ${opts.upcomingLeave.length === 0
            ? html`<p class="hint">${s.noTimeOff}</p>`
            : html`
                <dl class="kv">
                  ${opts.upcomingLeave.map(
                    (day) => html`
                      <dt>${day.label}</dt>
                      <dd>
                        <form method="post" action="/app/day/reopen" class="inline">
                          <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
                          <input type="hidden" name="date" value="${day.iso}" />
                          <button class="secondary sm" type="submit">${s.reopenDay}</button>
                        </form>
                      </dd>
                    `,
                  )}
                </dl>
                <p class="hint">${s.reopenWarning}</p>
              `}

          <form method="post" action="/app/day/close/confirm">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <label for="closeDate">${s.closeDay}</label>
            <input id="closeDate" name="date" type="date" min="${opts.today}" required />
            <button class="secondary" type="submit">${s.closeDay}</button>
          </form>
        </div>

        <div class="card">
          <h2>${s.waitingRoomBoard}</h2>
          <p class="sub">${s.waitingRoomBoardBody}</p>
          <p>
            <a class="walink" href="${opts.displayPath}" target="_blank" rel="noopener"
              >${s.openBoard}</a
            >
          </p>
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
                      >+${opts.bookingNumber}</a
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
