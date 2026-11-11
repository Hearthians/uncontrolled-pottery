// Frozen before any model output. These are independent AI-assisted draft ratings,
// NOT human ratings. A qualified human must review and attest them separately.
export const SCALE_KEYS = ['calm', 'anxiety', 'anger', 'stress', 'sadness'] as const;
export type Key = typeof SCALE_KEYS[number];
export type Interval = readonly [number, number];
export type Review = { index: number; intervals: Record<Key, Interval>; evidence: string; uncertainty: string };

export const SCALE_GUIDE = {
  anchors: '0 absent/not inferable; 1 slight or implied; 2 mild clear; 3 moderate; 4 strong; 5 very strong explicitly sustained',
  calm: 'Felt peace, ease or reassurance, not merely neutral.',
  anxiety: 'Anticipation, worry, uncertainty or fear of the future.',
  anger: 'Irritation, resentment, indignation or hostility.',
  stress: 'Felt pressure, strain or overload, not merely busyness or obligations.',
  sadness: 'Grief, sorrow, loneliness or disappointment; not automatically death or separation.',
  method: 'Five independent ratings of emotions expressed by the narrator, not a diagnosis. Do not infer the narrator’s feelings from another person or the event alone. When an emotion is not inferable, use zero; use intervals only for an actual ambiguity in the text.',
} as const;

function review(index: number, evidence: string, uncertainty: string, nonzero: Partial<Record<Key, Interval>> = {}): Review {
  return { index, evidence, uncertainty, intervals: { calm: [0, 0], anxiety: [0, 0], anger: [0, 0], stress: [0, 0], sadness: [0, 0], ...nonzero } };
}
export const REVIEWS: readonly Review[] = [
  review(1412, 'Solo travel is named.', 'No feeling is expressed.'),
  review(840, 'A sister has a baby.', 'No feeling is expressed.'),
  review(804, 'Making own clothes is named.', 'No feeling is expressed.'),
  review(1483, 'First instance of skipping class.', 'No feeling is expressed.'),
  review(829, 'Camping under stars.', 'Scenery alone does not establish felt calm.'),
  review(882, 'A trip during reading week.', 'No feeling is expressed.'),
  review(515, 'A graduation ceremony.', 'No feeling is expressed.'),
  review(1439, 'A meal with friends.', 'No feeling is expressed.'),
  review(508, 'Badminton without class.', 'No feeling is expressed.'),
  review(934, 'Getting lost on a solo trip.', 'Being lost does not establish fear.'),
  review(1001, 'Oversleeping before an exam.', 'Deadline alone does not establish pressure or fear.'),
  review(303, 'Chess in a park with friends.', 'No feeling is expressed.'),
  review(766, 'Firecrackers with children.', 'No narrator emotion is expressed.'),
  review(1484, 'Daily video calls to grandparents.', 'Contact alone does not establish reassurance.'),
  review(532, 'Dancing at rock festivals.', 'Dancing alone does not establish emotional intensity.'),
  review(1563, 'Quiet wonder and joy are explicitly felt.', 'Quiet wonder may imply mild peace, but joy is not itself calm.', { calm: [0, 2] }),
  review(1488, 'A mountain walk watching birds.', 'No felt peace is stated.'),
  review(264, 'All-night group assignment.', 'Work and sleep loss alone do not establish felt strain.'),
  review(1803, 'Witnessing emergency treatment.', 'No narrator emotion is expressed.'),
  review(1786, 'Enjoying an outing with friends.', 'Enjoyment alone is not peace or reassurance.'),
  review(1855, 'Finishing a jogging drill.', 'Exercise alone does not establish emotional strain.'),
  review(79, 'Playing table tennis with parents.', 'No feeling is expressed.'),
  review(788, 'Exploring a new city.', 'Novelty alone does not establish fear or calm.'),
  review(1644, 'Watching fishermen in mist.', 'A peaceful scene is not evidence of felt calm.'),
  review(949, 'Blisters from new shoes.', 'Physical pain alone does not establish a target emotion.'),
  review(326, 'A powered-parachute flight; the Chinese phrase names the equipment.', 'No feeling is expressed.'),
  review(525, 'A mistake slowed a group assignment.', 'No guilt, pressure or worry is expressed.'),
  review(616, 'An unexpected successful stage role.', 'No emotional response is expressed.'),
  review(198, 'Shopping alone for happiness-boosting things.', 'Happiness is not itself evidence of calm.'),
  review(619, 'An exciting drive by a cliff.', 'Excitement or danger alone is not evidence of anxiety.'),
  review(72, 'A flag-raising trip with parents.', 'No feeling is expressed.'),
  review(689, 'Daily crying and not wanting family separation at school.', 'Crying and separation imply sadness; fear and strain are possible but not explicit.', { sadness: [2, 4], anxiety: [0, 1], stress: [0, 1] }),
  review(1098, 'Reversed sleep and binge watching.', 'Behavior alone does not establish a target emotion.'),
  review(1906, 'New Year activities with friends.', 'No feeling is expressed.'),
  review(1506, 'Pride from parents and effort feeling worthwhile.', 'Reassurance is plausible but not explicitly stated.', { calm: [0, 1] }),
  review(820, 'A dream about an absent deceased father and awakening.', 'Loss or a dream alone does not establish grief or anxiety.'),
  review(1817, 'Explicitly lost and uncertain about the future for months.', 'Future uncertainty is clear; prolonged job search does not itself prove felt strain.', { anxiety: [2, 4], stress: [0, 1] }),
  review(415, 'A cat felt a little intimidating; mutual caution; later amusement.', 'Mild fear/caution could count as anxiety despite not explicitly future-oriented.', { anxiety: [0, 2] }),
  review(1023, 'Extremely upset and crying after an argument.', 'Upset with crying supports sadness; argument alone does not demonstrate anger.', { sadness: [2, 4], anger: [0, 1] }),
  review(1328, 'A head injury and hospital treatment are described.', 'Medical urgency and blood do not demonstrate narrator fear or stress.'),
];
