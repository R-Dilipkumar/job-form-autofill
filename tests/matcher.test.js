const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/matcher.js');

test('normalize strips stars, required marks and punctuation', () => {
  assert.equal(m.normalize('  First Name *  (required)'), 'first name');
  assert.equal(m.normalize('Email Address:'), 'email address');
  assert.equal(m.normalize('Résumé / CV'), 'resume cv');
});

test('common fields are spotted from the label', () => {
  const cases = {
    'First Name': '@first_name',
    'Legal first name': '@first_name',
    'Last Name *': '@last_name',
    Surname: '@last_name',
    'Full name': '@full_name',
    Name: '@full_name',
    'Email address': '@email',
    'E-mail': '@email',
    'Phone number': '@phone',
    'Mobile': '@phone',
    'LinkedIn Profile URL': '@linkedin',
    'GitHub': '@github',
    'Portfolio / Website': '@website',
    'Location (City)': '@city',
    'Pin code': '@postal_code',
    'ZIP Code': '@postal_code',
    'Notice period (in days)': '@notice_period',
    'Current CTC': '@current_salary',
    'Expected CTC': '@expected_salary',
    'What are your salary expectations?': '@expected_salary',
    'Are you legally authorized to work in the United States?': '@work_authorization',
    'Will you now or in the future require sponsorship?': '@sponsorship',
    'How did you hear about us?': '@how_heard',
    'Total years of experience': '@years_experience',
  };
  for (const [label, key] of Object.entries(cases)) {
    assert.equal(m.keyFor(label), key, label);
  }
});

test('look-alike labels are not taken for common fields', () => {
  assert.equal(m.keyFor('Phone country code'), 'phone country code');
  assert.equal(m.keyFor('Company name'), 'company name');
  assert.equal(m.keyFor('Country code'), 'country code');
  assert.equal(m.keyFor('Why do you want to join us?'), 'why do you want to join us');
});

test('autocomplete and input type are used as hints', () => {
  assert.equal(m.keyFor('Field 1', { autocomplete: 'given-name' }), '@first_name');
  assert.equal(m.keyFor('Contact', { type: 'email' }), '@email');
  assert.equal(m.keyFor('Contact', { type: 'tel' }), '@phone');
});

test('sensitive and consent questions are flagged', () => {
  assert.ok(m.isSensitive('Social Security Number'));
  assert.ok(m.isSensitive('Aadhaar number'));
  assert.ok(m.isSensitive('Password'));
  assert.ok(!m.isSensitive('Pin code'));
  assert.ok(!m.isSensitive('First name'));
  assert.ok(m.isConsent('I agree to the Terms and Privacy Policy'));
  assert.ok(m.isConsent('I certify that the information above is true'));
  assert.ok(m.isConsent('Signature'));
  assert.ok(!m.isConsent('Are you willing to relocate?'));
});

test('findAnswer: exact key, derived names, and guesses', () => {
  const answers = {
    '@first_name': { question: 'First name', value: 'Asha' },
    '@last_name': { question: 'Last name', value: 'Kumar' },
    'are you willing to relocate': { question: 'Are you willing to relocate?', value: 'Yes' },
    'why do you want to work here': { question: 'Why do you want to work here?', value: 'Because.' },
  };

  assert.equal(m.findAnswer('@first_name', 'First name', answers).how, 'exact');

  const full = m.findAnswer('@full_name', 'Full name', answers);
  assert.equal(full.how, 'derived');
  assert.equal(full.entry.value, 'Asha Kumar');

  const guess = m.findAnswer(m.keyFor('Would you be willing to relocate?'), 'Would you be willing to relocate?', answers);
  assert.equal(guess.how, 'guess');
  assert.equal(guess.entry.value, 'Yes');

  assert.equal(m.findAnswer(m.keyFor('Are you willing to travel?'), 'Are you willing to travel?', answers), null);
  assert.equal(m.findAnswer('@email', 'Email', answers), null, 'common fields never guessed');
});

test('findAnswer splits a saved full name', () => {
  const answers = { '@full_name': { question: 'Full name', value: 'Asha Devi Kumar' } };
  assert.equal(m.findAnswer('@first_name', 'First', answers).entry.value, 'Asha Devi');
  assert.equal(m.findAnswer('@last_name', 'Last', answers).entry.value, 'Kumar');
});

test('bestOption picks the right choice', () => {
  const yesNo = ['Select...', 'Yes, I am authorized', 'No, I am not authorized'];
  assert.equal(m.bestOption('Yes', yesNo), 1);
  assert.equal(m.bestOption('No', yesNo), 2);
  assert.equal(m.bestOption('no', ['Yes', 'No']), 1);
  assert.equal(m.bestOption('India', ['United States', 'India', 'Indonesia']), 1);
  assert.equal(m.bestOption('LinkedIn', ['Indeed', 'LinkedIn Jobs', 'Referral']), 1);
  assert.equal(m.bestOption('Mars', ['Earth', 'Venus']), -1);
  assert.equal(m.bestOption('Select...', ['Select...', 'A']), -1);
});
