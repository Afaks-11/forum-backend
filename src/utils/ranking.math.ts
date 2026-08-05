/**
 * Calculates Forum official Hot ranking score using logarithmic vote scaling
 * balanced against linear chronological time decay.
 */
export const calculateHotScore = (
	upvotes: number,
	downvotes: number,
	createdAt: Date,
): number => {
	const netVotes = upvotes - downvotes;

	// Logarithmic scaling keeps a viral post from permanently outranking newer
	// content: each additional order of magnitude of votes is worth only +1.
	const order = Math.log10(Math.max(Math.abs(netVotes), 1));

	const sign = netVotes > 0 ? 1 : netVotes < 0 ? -1 : 0;

	// Age is measured from a fixed epoch rather than "now" so a post's score is
	// stable and only changes when its votes change — recomputing against the
	// current time would reshuffle the entire ZSET on every worker pass.
	const baseEpochSeconds = new Date("2026-01-01T00:00:00Z").getTime() / 1000;
	const postSeconds = createdAt.getTime() / 1000;
	const ageInSeconds = postSeconds - baseEpochSeconds;

	// 45,000 seconds (12.5 hours) is the half-life: holding rank across one
	// window costs roughly 10x the votes.
	return order + (sign * ageInSeconds) / 45000;
};

/**
 * Calculates a Controversial rank score. High total vote volumes with nearly
 * equal splits between upvotes and downvotes yield the highest performance values.
 */
export const calculateControversialScore = (
	upvotes: number,
	downvotes: number,
): number => {
	const totalVotes = upvotes + downvotes;
	const margin = Math.abs(upvotes - downvotes);

	if (totalVotes === 0) return 0;

	// The margin is floored at 1 so a perfectly split post does not divide by
	// zero; volume then becomes the sole differentiator between dead heats.
	return totalVotes / Math.max(margin, 1);
};
