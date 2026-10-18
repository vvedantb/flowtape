// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createCapture, createRecorder } from '../src/recorder';
import { REDACTED, isMaskedElement, isNhsNumber, redactInput, scrubText } from '../src/redact';
import type { FlowEvent } from '../src/types';

// 943 476 5919 is the example NHS number in NHS Digital documentation. 943 476 5918 fails the check digit.
const NHS = '943 476 5919';

describe('scrubText personal data', () => {
  it('redacts NHS numbers that pass the check digit, in any grouping', () => {
    expect(isNhsNumber('9434765919')).toBe(true);
    expect(isNhsNumber('9434765918')).toBe(false);
    expect(scrubText(`NHS ${NHS}`)).toBe(`NHS ${REDACTED}`);
    expect(scrubText('/patients/9434765919/notes')).toBe(`/patients/${REDACTED}/notes`);
    expect(scrubText('943-476-5919')).toBe(REDACTED);
    // Other 10-digit ids and longer numbers survive.
    expect(scrubText('order 9434765918')).toBe('order 9434765918');
    expect(scrubText('94347659190')).toBe('94347659190');
  });

  it('redacts real emails, postcodes and UK mobiles, but keeps reserved example domains', () => {
    expect(scrubText('mail jane.doe@nhs.net now')).toBe(`mail ${REDACTED} now`);
    expect(scrubText('ada@example.test')).toBe('ada@example.test');
    expect(scrubText('you@example.com')).toBe('you@example.com');
    expect(scrubText('Lives at SW1A 1AA')).toBe(`Lives at ${REDACTED}`);
    expect(scrubText('m1 1ae')).toBe(REDACTED);
    expect(scrubText('call 07700 900123 or +44 7700 900123')).toBe(`call ${REDACTED} or ${REDACTED}`);
    // Ordinary text with digits survives.
    expect(scrubText('Care Tier 2, week 14, £1000')).toBe('Care Tier 2, week 14, £1000');
  });

  it('masks inputs whose name or label says date of birth or NHS number', () => {
    expect(redactInput({ type: 'input', ts: 0, selector: '#x', value: '01/02/1950', name: 'Date of birth', redacted: false })).toMatchObject({ redacted: true, value: null, length: 10 });
    expect(redactInput({ type: 'input', ts: 0, selector: '[name="patient_dob"]', value: '1950-02-01', redacted: false })).toMatchObject({ redacted: true, value: null });
    expect(redactInput({ type: 'input', ts: 0, selector: '#nhs-number', value: '123', redacted: false })).toMatchObject({ redacted: true, value: null });
    expect(redactInput({ type: 'input', ts: 0, selector: '#start', value: '01/03/2024', name: 'Placement start date', redacted: false })).toMatchObject({ redacted: false, value: '01/03/2024' });
  });
});

describe('isMaskedElement at record time', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="dob">Date of birth</label><input id="dob">
      <label for="start">Start date</label><input id="start">
      <section data-flowtape-allowlist>
        <label for="name">Full name</label><input id="name">
        <label for="tier">Care tier</label><input id="tier" data-flowtape-safe>
        <button id="save">Save placement</button>
        <a id="person" href="/people/1">Jane Doe</a>
        <div data-flowtape-safe><a id="nav" href="/home">Home</a></div>
      </section>`;
  });

  const masked = (id: string) => isMaskedElement(document.getElementById(id) as Element);

  it('masks a field by its label text', () => {
    expect(masked('dob')).toBe(true);
    expect(masked('start')).toBe(false);
  });

  it('in allowlist mode, masks every field and non-control unless marked safe, and keeps control names', () => {
    expect(masked('name')).toBe(true);
    expect(masked('tier')).toBe(false);
    expect(masked('save')).toBe(false);
    expect(masked('person')).toBe(true);
    expect(masked('nav')).toBe(false);
  });
});

describe('recording in allowlist mode', () => {
  it('stores no typed value or link text unless marked safe', async () => {
    document.body.innerHTML = `
      <main data-flowtape-allowlist>
        <label for="name">Full name</label><input id="name">
        <label for="tier">Care tier</label><input id="tier" data-flowtape-safe>
        <a id="person" href="#p">Jane Doe</a>
        <button id="save" type="button">Save placement</button>
      </main>`;
    const recorder = createRecorder({ capture: createCapture({ debounceMs: 0 }) });
    recorder.start();
    const type = (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    type('name', 'Jane Doe');
    type('tier', '2');
    (document.getElementById('person') as HTMLElement).click();
    (document.getElementById('save') as HTMLElement).click();
    recorder.stop();
    const events: FlowEvent[] = recorder.getSnapshot().events;
    expect(JSON.stringify(events)).not.toContain('Jane Doe');
    expect(events.filter((e) => e.type === 'input')).toMatchObject([
      { name: 'Full name', redacted: true, value: null, length: 8 },
      { name: 'Care tier', redacted: false, value: '2' },
    ]);
    expect(events.filter((e) => e.type === 'click').map((e) => (e.type === 'click' ? e.name : ''))).toEqual([undefined, 'Save placement']);
  });
});
