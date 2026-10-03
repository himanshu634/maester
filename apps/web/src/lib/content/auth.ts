/**
 * Copy for sign-in, sign-up and recovery. DESIGN.md section 7: plain verbs, no
 * codes, no internals; the waitlist message promises nothing.
 */
export const authContent = {
	login: {
		title: 'Sign in. Maester',
		heading: 'Sign in to the terminal',
		lede: 'The terminal is where your holdings, your thesis and your suggestions live.',
		google: 'Continue with Google',
		googleBusy: 'Opening Google…',
		googleStatus: 'Taking you to Google to sign in.',
		or: 'or use your email',
		newHere: 'New to Maester?',
		createAccount: 'Create an account',
		back: 'Back to the index page',
		noScript: 'Signing in needs JavaScript. Turn it on for this site and reload the page.',
		alreadySignedIn: 'You are already signed in. Taking you to the terminal.',
		email: 'Email',
		password: 'Password',
		// Sign-in checks only that a password was typed: a stored one may predate today's rules.
		passwordMissing: 'Enter your password.',
		// "Try again, or reset your password." with the last words linking to /forgot-password.
		wrongPassword: { before: 'Try again, or ', link: 'reset your password', after: '.' },
		signIn: 'Sign in',
		signingIn: 'Signing in…',
		forgot: 'Forgot your password?',
		resend: 'Send the link again',
		resending: 'Sending…',
		resent: 'Sent. Check your email for a new link.',
		passwordChanged: 'Password changed. Sign in with your new password.'
	},
	forgot: {
		title: 'Reset your password. Maester',
		heading: 'Reset your password',
		lede: 'Enter the email you sign in with. We’ll send a link to set a new password.',
		send: 'Send reset link',
		sending: 'Sending…',
		// The same words whether or not the address has an account.
		sentTitle: 'Check your email',
		sent: (email: string) =>
			`If ${email} has a Maester account, a reset link is on its way. It works once, for one hour.`,
		failedTitle: 'We couldn’t send the link',
		backToSignIn: 'Back to sign in'
	},
	reset: {
		title: 'Set a new password. Maester',
		heading: 'Set a new password',
		newPassword: 'New password',
		set: 'Set new password',
		setting: 'Saving…',
		failedTitle: 'We couldn’t save your password',
		expiredHeading: 'This reset link has expired',
		expiredLede: 'Reset links work once, for one hour.',
		requestNew: 'Request a new link'
	},
	waitlisted: {
		title: 'You’re on the list. Maester',
		heading: 'You’re on the list',
		bodyGoogle:
			'Maester is open to invited investors for now. We’ve added your Google email address to the list.',
		nothingCreated:
			'Nothing else to do. No account or workspace was created, and nothing was kept from Google but your email address.',
		wrongAccount: 'Signed in with the wrong Google account?',
		useAnother: 'Use another account'
	},
	signup: {
		title: 'Create your account. Maester',
		heading: 'Create your account',
		lede: 'Maester is open to invited investors for now. Use the email your invitation went to.',
		google: 'Sign up with Google',
		or: 'or use your email',
		name: 'Name',
		passwordHint: 'At least 8 characters.',
		create: 'Create account',
		creating: 'Creating your account…',
		googleStatus: 'Taking you to Google to sign up.',
		haveAccount: 'Already have an account?',
		signIn: 'Sign in'
	},
	verify: {
		title: 'Check your email. Maester',
		heading: 'Check your email',
		// The same words whether or not the address was on the invitation list: the
		// page never says which, so it cannot be used to probe the list.
		sent: (email: string) =>
			`If ${email} is on the invitation list, we sent it a link to confirm your account. Open it on this device. It works for one hour. If it isn’t on the list yet, we’ve added it. There’s nothing else to do.`,
		sentNoEmail:
			'If your email is on the invitation list, we sent it a link to confirm your account. Open it on this device. It works for one hour. If it isn’t on the list yet, we’ve added it. There’s nothing else to do.',
		notArrived: 'Didn’t get it?',
		notArrivedBody: 'Check spam, or send it again. Links can take a minute to arrive.',
		sendAgain: 'Send it again',
		sending: 'Sending…',
		sentAgain: 'Sent. Check your email for a new link.',
		differentEmail: 'Wrong address?',
		useDifferent: 'Use a different email',
		expiredTitle: 'That link has expired. Maester',
		expiredHeading: 'That link has expired',
		expiredLede: 'Confirmation links last one hour. Send a new one to your email.',
		sendNew: 'Send a new link',
		confirmed: 'Email confirmed. Taking you to the terminal.'
	},
	// Field checks before anything is sent: each says the fix.
	fields: {
		emailInvalid: 'Enter a full email address, like name@example.com.',
		passwordMissing: 'Enter a password.',
		passwordTooShort: (length: number) => `Use at least 8 characters. This one has ${length}.`,
		passwordTooLong: 'Use 128 characters or fewer.',
		nameMissing: 'Enter your name.',
		// The password field's toggle: the name stays the same and aria-pressed carries the state.
		show: 'Show',
		showPassword: 'Show password'
	},
	messages: {
		cancelled: {
			title: 'Google sign-in was cancelled',
			body: 'Nothing was shared. Try again, or use your email.'
		},
		wrongPassword: {
			title: 'That email and password don’t match',
			body: 'Try again, or reset your password.'
		},
		notVerified: {
			title: 'Confirm your email first',
			body: 'We sent you a link when you created your account. It works for one hour.'
		},
		googleEmailNotVerified: {
			title: 'Google hasn’t confirmed this email',
			body: 'Confirm the address with Google, or use another account.'
		},
		rateLimited: {
			title: 'Too many attempts',
			body: 'Wait a minute, then try again. Your account is not locked.'
		},
		linkExpired: {
			title: 'That link has expired',
			body: 'Links last one hour. Ask for a new one below.'
		},
		generic: {
			title: 'Sign-in didn’t finish',
			body: 'Something went wrong on our side. Try again in a moment.'
		}
	}
} as const;
