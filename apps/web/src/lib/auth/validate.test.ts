import { describe, expect, it } from 'vitest';
import { validateEmail, validateName, validatePassword } from './validate';

describe('validateEmail', () => {
	it.each(['meera.iyer@example.com', ' a@b.co '])('accepts %j', (v) => {
		expect(validateEmail(v)).toBeNull();
	});
	it.each(['', '   ', 'meera.iyer@example', 'meera', '@example.com', 'a b@example.com'])(
		'refuses %j',
		(v) => {
			expect(validateEmail(v)).toMatch(/email address/);
		}
	);
});

describe('validatePassword', () => {
	it('accepts 8 characters or more', () => {
		expect(validatePassword('12345678')).toBeNull();
	});
	it('says how many characters it has', () => {
		expect(validatePassword('123456')).toBe('Use at least 8 characters. This one has 6.');
		expect(validatePassword('')).toBe('Enter a password.');
	});
	it('refuses more than 128 characters', () => {
		expect(validatePassword('x'.repeat(129))).toBe('Use 128 characters or fewer.');
	});
});

describe('validateName', () => {
	it('needs something', () => {
		expect(validateName('  ')).toBe('Enter your name.');
		expect(validateName('Meera Iyer')).toBeNull();
	});
});
