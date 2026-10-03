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
		signIn: 'Sign in',
		signingIn: 'Signing in…',
		forgot: 'Forgot your password?',
		resend: 'Send the link again',
		resending: 'Sending…',
		resent: 'Sent. Check your email for a new link.'
	},
	waitlisted: {
		heading: 'You’re on the list',
		bodyGoogle:
			'Maester is open to invited investors for now. We’ve added your Google email address to the list.',
		bodyEmail: (email: string) =>
			`Maester is open to invited investors for now. We’ve added ${email} to the list.`,
		nothingCreated:
			'Nothing else to do. No account or workspace was created, and nothing was kept from Google but your email address.',
		wrongAccount: 'Signed in with the wrong Google account?',
		useAnother: 'Use another account'
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
