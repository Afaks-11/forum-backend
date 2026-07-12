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

	// Logarithmic scale prevents explosive viral trends from permanently burying new content
	const order = Math.log10(Math.max(Math.abs(netVotes), 1));

	const sign = netVotes > 0 ? 1 : netVotes < 0 ? -1 : 0;

	// Systems baseline anchored precisely to the 2026 production epoch
	const baseEpochSeconds = new Date("2026-01-01T00:00:00Z").getTime() / 1000;
	const postSeconds = createdAt.getTime() / 1000;
	const ageInSeconds = postSeconds - baseEpochSeconds;

	// 45,000 seconds = 12.5 hours. A post requires 10x more votes to sustain rank every half-day.
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

	// Minimizing the margin maximizes the controversy modifier ratio
	return totalVotes / Math.max(margin, 1);
};
