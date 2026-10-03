/** Field checks before anything is sent. Copy says the fix (DESIGN.md section 7). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
	return EMAIL.test(value.trim()) ? null : 'Enter a full email address, like name@example.com.';
}

export function validatePassword(value: string): string | null {
	if (value.length === 0) return 'Enter a password.';
	if (value.length < 8) return `Use at least 8 characters. This one has ${value.length}.`;
	if (value.length > 128) return 'Use 128 characters or fewer.';
	return null;
}

export function validateName(value: string): string | null {
	return value.trim() ? null : 'Enter your name.';
}

/** After a failed submit, move focus to the first field with an error. */
export function focusFirstInvalid(
	errors: Record<string, string | null | undefined>,
	ids: Record<string, string>
): void {
	const first = Object.keys(ids).find((key) => errors[key]);
	if (first) document.getElementById(ids[first])?.focus();
}
