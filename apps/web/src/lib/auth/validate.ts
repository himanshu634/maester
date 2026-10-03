/** Field checks before anything is sent. Copy says the fix (DESIGN.md section 7). */
import { tick } from 'svelte';
import { authContent } from '$lib/content/auth';

const fields = authContent.fields;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
	return EMAIL.test(value.trim()) ? null : fields.emailInvalid;
}

export function validatePassword(value: string): string | null {
	if (value.length === 0) return fields.passwordMissing;
	if (value.length < 8) return fields.passwordTooShort(value.length);
	if (value.length > 128) return fields.passwordTooLong;
	return null;
}

export function validateName(value: string): string | null {
	return value.trim() ? null : fields.nameMissing;
}

/** After a failed submit, move focus to the first field with an error. */
export function focusFirstInvalid(
	errors: Record<string, string | null | undefined>,
	ids: Record<string, string>
): void {
	const first = Object.keys(ids).find((key) => errors[key]);
	if (first) document.getElementById(ids[first])?.focus();
}

/**
 * After a failed request, return focus to the button that sent it. The button was disabled
 * while the request ran, which drops focus to the page, so wait for the re-render that
 * enables it again. Pass a getter: the element may be re-created by that render.
 */
export async function focusAfterFailure(
	button: () => HTMLElement | null | undefined
): Promise<void> {
	await tick();
	button()?.focus();
}
