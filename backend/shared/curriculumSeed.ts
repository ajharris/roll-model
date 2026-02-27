import type { CurriculumStage, Skill, SkillRelationship } from './types';

export const BASELINE_STAGES: Array<Omit<CurriculumStage, 'updatedAt'>> = [
  {
    stageId: 'white-belt',
    name: 'White Belt',
    order: 1,
    milestoneSkills: ['bridge-hip-escape', 'closed-guard-retention']
  },
  {
    stageId: 'blue-belt',
    name: 'Blue Belt',
    order: 2,
    milestoneSkills: ['scissor-sweep', 'knee-cut-pass']
  },
  {
    stageId: 'purple-belt',
    name: 'Purple Belt',
    order: 3,
    milestoneSkills: ['x-guard-sweep', 'back-control-finish']
  },
  {
    stageId: 'brown-belt',
    name: 'Brown Belt',
    order: 4,
    milestoneSkills: ['leg-drag-pass', 'front-headlock-systems']
  },
  {
    stageId: 'black-belt',
    name: 'Black Belt',
    order: 5,
    milestoneSkills: ['adaptive-game-planning', 'counter-chain-mastery']
  }
];

export const BASELINE_SKILLS: Array<Omit<Skill, 'createdAt' | 'updatedAt'>> = [
  {
    skillId: 'bridge-hip-escape',
    name: 'Bridge + Hip Escape',
    category: 'escape',
    stageId: 'white-belt',
    prerequisites: [],
    keyConcepts: ['frames', 'angle change'],
    commonFailures: ['bridging straight up', 'late frames'],
    drills: ['bridge-shrimp ladder', 'wall shrimping']
  },
  {
    skillId: 'closed-guard-retention',
    name: 'Closed Guard Retention',
    category: 'guard-retention',
    stageId: 'white-belt',
    prerequisites: ['bridge-hip-escape'],
    keyConcepts: ['knee-elbow connection', 'hip mobility'],
    commonFailures: ['hips pinned flat', 'crossed ankles too high'],
    drills: ['retention rounds from standing break', 'hip-heist reset reps']
  },
  {
    skillId: 'scissor-sweep',
    name: 'Scissor Sweep',
    category: 'sweep',
    stageId: 'blue-belt',
    prerequisites: ['closed-guard-retention'],
    keyConcepts: ['kuzushi', 'cross grip control'],
    commonFailures: ['not loading partner weight', 'bottom leg too low'],
    drills: ['kuzushi to scissor sweep flow', '1-minute timing rounds']
  },
  {
    skillId: 'knee-cut-pass',
    name: 'Knee Cut Pass',
    category: 'pass',
    stageId: 'blue-belt',
    prerequisites: ['bridge-hip-escape'],
    keyConcepts: ['head position', 'underhook control'],
    commonFailures: ['hips too far away', 'chest disconnect'],
    drills: ['knee-cut entries with resistance', 'underhook pummel rounds']
  },
  {
    skillId: 'x-guard-sweep',
    name: 'X-Guard Technical Stand-up Sweep',
    category: 'sweep',
    stageId: 'purple-belt',
    prerequisites: ['scissor-sweep'],
    keyConcepts: ['off-balance timing', 'ankle-line control'],
    commonFailures: ['standing before off-balance', 'missing far sleeve control'],
    drills: ['x-guard elevation reps', 'reaction sweep rounds']
  }
];

export const BASELINE_RELATIONSHIPS: Array<Omit<SkillRelationship, 'createdAt' | 'updatedAt'>> = [
  {
    fromSkillId: 'closed-guard-retention',
    toSkillId: 'scissor-sweep',
    relation: 'prerequisite',
    rationale: 'Reliable closed guard retention is required before timing scissor sweep entries.'
  },
  {
    fromSkillId: 'scissor-sweep',
    toSkillId: 'x-guard-sweep',
    relation: 'supports',
    rationale: 'Shared off-balance mechanics transfer into x-guard sweep entries.'
  },
  {
    fromSkillId: 'knee-cut-pass',
    toSkillId: 'x-guard-sweep',
    relation: 'counter',
    rationale: 'Understanding knee cut passing sharpens sweep setup against pressure passers.'
  }
];
