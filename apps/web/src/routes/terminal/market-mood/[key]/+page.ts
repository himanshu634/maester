import { error } from '@sveltejs/kit';
import { isReadingKey, READING_KEYS } from '$lib/market-mood/types';
import type { EntryGenerator, PageLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () => READING_KEYS.map((key) => ({ key }));

export const load: PageLoad = ({ params }) => {
	if (!isReadingKey(params.key)) error(404, 'Not found');
	return { key: params.key };
};
