<!--
	A sketched scene: an investor at an old computer, reading charts, thinking
	there has to be a better way than doing this every night. Drawn as two plates, like a cheap
	two-colour print: the colour plate sits slightly out of register under the
	ink plate, and every ink line is drawn twice, the second pass fainter and
	offset, so it reads as hand-drawn. Colours come from the --illus-* tokens
	only. The rounded frame is drawn by the parent (see the login page).
-->
<svg
	viewBox="0 0 640 640"
	preserveAspectRatio="xMidYMax meet"
	role="img"
	aria-labelledby="login-illus-title"
	class="illus"
>
	<title id="login-illus-title"
		>A sketch of a person sitting at an old desktop computer, studying charts on the screen and on
		the wall, thinking: reading all of this is pretty frustrating.</title
	>
	<defs>
		<filter id="illus-rough" x="-2%" y="-2%" width="104%" height="104%">
			<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="n"
				scale="3.2"
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
		<filter id="illus-rough-2" x="-2%" y="-2%" width="104%" height="104%">
			<feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="n"
				scale="4"
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
		<pattern
			id="illus-hatch"
			width="7"
			height="7"
			patternUnits="userSpaceOnUse"
			patternTransform="rotate(40)"
		>
			<line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="1.6" />
		</pattern>

		<!-- The thought cloud outline, shared by both plates. -->
		<path
			id="illus-cloud"
			d="M52 160 A28 28 0 0 1 42 116 A40 40 0 0 1 92 72 A44 44 0 0 1 162 48 A48 48 0 0 1 242 48 A46 46 0 0 1 312 76 A38 38 0 0 1 346 130 A36 36 0 0 1 318 184 A44 44 0 0 1 250 204 A48 48 0 0 1 170 210 A44 44 0 0 1 98 198 A34 34 0 0 1 52 160 Z"
		/>

		<!-- The ink plate. Stroke width is set by whoever uses it. -->
		<g
			id="illus-ink"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<!-- thought cloud and its trail down to the head -->
			<use href="#illus-cloud" />
			<circle cx="206" cy="216" r="7" />
			<circle cx="198" cy="237" r="5" />
			<circle cx="192" cy="253" r="3.5" />

			<!-- wall chart, pinned slightly askew -->
			<g transform="translate(0 70) rotate(-4 545 125)">
				<rect x="480" y="62" width="130" height="128" />
				<circle cx="545" cy="68" r="4" fill="currentColor" />
				<path d="M494 172 H 600" />
				<path d="M494 172 V 84" />
				<path d="M498 152 L 522 134 L 546 142 L 571 108 L 596 94" stroke-width="3.5" />
				<path d="M590 88 l 8 4 l -6 6" />
			</g>

			<g transform="translate(0 120)">
				<!-- floor -->
				<path d="M18 442 Q 320 436 622 441" />

				<!-- desk -->
				<path d="M228 290 H 592" stroke-width="4" />
				<path d="M232 304 H 588" />
				<path d="M228 290 L 226 304 M592 290 L 594 304" />
				<path d="M250 304 V 440 M570 304 V 440" />
				<path d="M250 420 H 288 M532 420 H 570" />

				<!-- keyboard -->
				<rect x="238" y="278" width="88" height="12" rx="3" />
				<path
					d="M248 284 h5 M258 284 h5 M268 284 h5 M278 284 h5 M288 284 h5 M298 284 h5 M308 284 h5"
					stroke-width="2"
				/>

				<!-- monitor -->
				<path d="M338 268 L 332 290 H 408 L 402 268" />
				<rect x="272" y="118" width="176" height="150" rx="10" />
				<rect x="290" y="136" width="140" height="100" rx="4" fill="currentColor" />
				<circle cx="302" cy="254" r="4" />
				<circle cx="318" cy="254" r="4" />
				<path d="M398 252 H 432 M398 259 H 432" stroke-width="2" />
				<path d="M448 130 l 14 10 V 258 l -14 8" />

				<!-- mug -->
				<rect x="518" y="256" width="30" height="34" rx="3" />
				<path d="M548 264 C 564 264 564 284 548 284" />
				<path d="M527 249 c -5 -6 5 -10 0 -17 M539 249 c -5 -6 5 -10 0 -17" stroke-width="2" />

				<!-- chair -->
				<rect x="86" y="322" width="112" height="12" rx="3" />
				<rect x="82" y="214" width="14" height="112" rx="4" />
				<path d="M98 334 L 94 440 M178 334 L 182 440 M96 400 H 180" />

				<!-- person: legs, torso, arm, head -->
				<path d="M120 334 L 214 330 L 218 352 L 122 354 Z" fill="url(#illus-hatch)" />
				<path d="M200 346 L 220 344 L 228 428 L 208 430 Z" fill="url(#illus-hatch)" />
				<path d="M204 428 L 250 428 L 252 440 L 198 440 Z" fill="currentColor" />
				<path
					d="M118 338 C 112 292 118 246 136 222 L 168 210 L 192 228 C 186 270 182 302 178 338 Z"
				/>
				<path d="M182 238 L 218 270 L 266 284 L 268 294 L 214 284 L 176 252" />
				<circle cx="266" cy="289" r="6" />
				<path d="M170 208 L 172 216 M186 206 L 187 216" />
				<circle cx="182" cy="176" r="30" />
				<path
					d="M152 172 C 150 136 202 128 214 156 C 202 148 178 148 170 166 C 162 172 156 176 152 172 Z"
					fill="currentColor"
				/>
				<circle cx="197" cy="172" r="2.4" fill="currentColor" />
				<path d="M209 176 l 7 7 l -7 3" />
				<path d="M200 193 l 8 -3" />
				<rect x="188" y="164" width="20" height="13" rx="2" />
				<path d="M188 170 L 172 174" />
			</g>
		</g>
	</defs>

	<!-- colour plate, printed a little out of register -->
	<g class="colour" transform="translate(5 -4)">
		<use href="#illus-cloud" fill="var(--illus-yellow)" />
		<g transform="translate(0 70) rotate(-4 545 125)">
			<rect x="498" y="150" width="14" height="22" fill="var(--illus-blue)" />
			<rect x="518" y="136" width="14" height="36" fill="var(--illus-blue)" />
			<rect x="538" y="144" width="14" height="28" fill="var(--illus-blue)" />
			<rect x="558" y="118" width="14" height="54" fill="var(--illus-blue)" />
			<rect x="578" y="100" width="14" height="72" fill="var(--illus-blue)" />
		</g>
		<g transform="translate(0 120)">
			<rect
				x="272"
				y="118"
				width="176"
				height="150"
				rx="10"
				fill="var(--illus-yellow)"
				opacity="0.35"
			/>
			<rect x="86" y="322" width="112" height="12" rx="3" fill="var(--illus-red)" />
			<rect x="82" y="214" width="14" height="112" rx="4" fill="var(--illus-red)" />
			<path
				d="M118 338 C 112 292 118 246 136 222 L 168 210 L 192 228 C 186 270 182 302 178 338 Z"
				fill="var(--illus-blue)"
			/>
			<path
				d="M182 238 L 218 270 L 266 284 L 268 294 L 214 284 L 176 252 Z"
				fill="var(--illus-blue)"
			/>
			<rect x="518" y="256" width="30" height="34" rx="3" fill="var(--illus-red)" />
		</g>
	</g>

	<!-- ink plate: one firm pass, one faint offset pass -->
	<g class="ink" stroke-width="3" filter="url(#illus-rough)">
		<use href="#illus-ink" />
	</g>
	<g
		class="ink"
		stroke-width="1.4"
		opacity="0.45"
		transform="translate(2.5 2)"
		filter="url(#illus-rough-2)"
	>
		<use href="#illus-ink" />
	</g>

	<!-- the thought, set in type so it stays crisp -->
	<text class="thought" x="196" y="96" text-anchor="middle">
		<tspan x="196" y="96">Every filing, every price,</tspan>
		<tspan x="196" y="124">every night.</tspan>
		<tspan x="196" y="152">There has to be</tspan>
		<tspan x="196" y="180">a better way.</tspan>
	</text>

	<!-- what is on the screen, printed over the ink -->
	<g
		class="colour"
		transform="translate(3 118)"
		fill="none"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path
			d="M300 226 H 420 M300 196 H 420 M300 166 H 420"
			stroke="var(--paper)"
			stroke-width="1"
			opacity="0.35"
		/>
		<rect x="304" y="212" width="10" height="16" fill="var(--illus-blue)" />
		<rect x="322" y="204" width="10" height="24" fill="var(--illus-blue)" />
		<rect x="340" y="208" width="10" height="20" fill="var(--illus-blue)" />
		<rect x="358" y="196" width="10" height="32" fill="var(--illus-blue)" />
		<rect x="376" y="200" width="10" height="28" fill="var(--illus-blue)" />
		<rect x="394" y="184" width="10" height="44" fill="var(--illus-blue)" />
		<path
			d="M302 214 L 328 194 L 350 202 L 376 172 L 398 180 L 420 150"
			stroke="var(--illus-yellow)"
			stroke-width="3.5"
		/>
		<circle cx="420" cy="150" r="5" fill="var(--illus-red)" />
	</g>
</svg>

<style>
	.illus {
		width: 100%;
		height: 100%;
		color: var(--ink);
	}

	.thought {
		font-family: var(--font-hand);
		font-weight: 700;
		font-size: 27px;
		fill: currentColor;
	}
</style>
