// Pick a sensible board icon from the board's name, for boards whose icon
// hasn't been set explicitly. The first word that means something wins
// ("Moodboard – shoot day" → mood, not camera); keyword rules are checked
// before plain icon names for that word.

import { BOARD_ICONS, DEFAULT_BOARD_ICON, iconLabel } from './icons';

const RULES: [icon: string, words: string[]][] = [
  ['Sparkles', ['mood', 'moodboard', 'inspiration', 'inspo', 'vibe', 'vibes', 'aesthetic']],
  ['Images', ['reference', 'references', 'ref', 'refs', 'gallery', 'photos', 'stills', 'images', 'pictures']],
  ['LayoutDashboard', ['storyboard', 'storyboards', 'boards', 'layout', 'wireframe', 'wireframes', 'dashboard']],
  ['Clapperboard', ['shot', 'shots', 'scene', 'scenes', 'take', 'takes', 'production', 'prod', 'dailies', 'edit', 'edits', 'cut', 'cuts', 'post']],
  ['Film', ['film', 'films', 'movie', 'movies', 'cinema', 'feature', 'trailer', 'trailers', 'short']],
  ['Video', ['video', 'videos', 'footage', 'clip', 'clips', 'reel', 'reels', 'vlog']],
  ['Camera', ['shoot', 'shoots', 'camera', 'cameras', 'photo', 'photography', 'lens', 'lenses', 'dop', 'cinematography']],
  ['Palette', ['colour', 'color', 'grade', 'grading', 'palette', 'palettes', 'paint', 'art']],
  ['SwatchBook', ['brand', 'branding', 'identity', 'guidelines', 'styleguide', 'style']],
  ['WandSparkles', ['vfx', 'fx', 'effects', 'cg', 'cgi', 'compositing', 'comp', 'magic']],
  ['Box', ['3d', 'model', 'models', 'modeling', 'modelling', 'render', 'renders', 'asset', 'assets', 'blender', 'cinema4d', 'c4d']],
  ['Activity', ['motion', 'animation', 'animations', 'anim', 'mograph']],
  ['Music', ['music', 'song', 'songs', 'score', 'soundtrack', 'playlist']],
  ['AudioLines', ['audio', 'sound', 'sfx', 'mix', 'mixing', 'voice', 'vo', 'foley']],
  ['Mic', ['podcast', 'podcasts', 'interview', 'interviews', 'recording', 'recordings']],
  ['FileText', ['script', 'scripts', 'screenplay', 'copy', 'writing', 'brief', 'briefs', 'doc', 'docs', 'treatment', 'treatments']],
  ['MessagesSquare', ['review', 'reviews', 'feedback', 'notes', 'comments', 'approval', 'approvals']],
  ['ListChecks', ['todo', 'todos', 'tasks', 'task', 'checklist', 'checklists', 'backlog']],
  ['Calendar', ['schedule', 'schedules', 'calendar', 'timeline', 'timelines', 'plan', 'planning', 'roadmap', 'deadlines']],
  ['Users', ['team', 'teams', 'people', 'cast', 'crew', 'casting', 'talent', 'hr', 'hiring']],
  ['Briefcase', ['client', 'clients', 'work', 'business', 'agency', 'account', 'accounts']],
  ['Presentation', ['pitch', 'pitches', 'deck', 'decks', 'presentation', 'presentations', 'proposal', 'proposals']],
  ['Megaphone', ['marketing', 'social', 'campaign', 'campaigns', 'ads', 'advertising', 'launch', 'promo', 'pr']],
  ['MapPin', ['location', 'locations', 'scout', 'scouting', 'venue', 'venues', 'set', 'sets']],
  ['Plane', ['travel', 'trip', 'trips', 'flights', 'holiday', 'vacation']],
  ['DollarSign', ['budget', 'budgets', 'finance', 'finances', 'cost', 'costs', 'invoice', 'invoices', 'money', 'quote', 'quotes']],
  ['FlaskConical', ['research', 'r&d', 'rnd', 'experiment', 'experiments', 'lab', 'test', 'tests', 'prototype', 'prototypes']],
  ['Lightbulb', ['idea', 'ideas', 'brainstorm', 'brainstorming', 'concept', 'concepts', 'thinking']],
  ['PenTool', ['design', 'designs', 'illustration', 'illustrations', 'vector', 'logo', 'logos', 'type', 'typography']],
  ['Files', ['template', 'templates', 'kit', 'kits', 'library', 'resources', 'files']],
  ['Archive', ['archive', 'archived', 'old', 'past', 'legacy']],
  ['Shirt', ['wardrobe', 'costume', 'costumes', 'fashion', 'clothing', 'styling']],
  ['Gamepad2', ['game', 'games', 'gaming', 'interactive']],
  ['Code', ['code', 'dev', 'development', 'engineering', 'web', 'website', 'app', 'tech']],
  ['Rocket', ['startup', 'release', 'ship', 'mvp']],
  ['Target', ['goal', 'goals', 'okr', 'okrs', 'objectives', 'strategy']],
  ['GraduationCap', ['learning', 'course', 'courses', 'training', 'tutorial', 'tutorials', 'school', 'study']],
  ['House', ['home', 'house', 'personal', 'me', 'mine']],
  ['Heart', ['favourites', 'favorites', 'faves', 'love', 'wishlist']],
  ['Star', ['best', 'top', 'highlights', 'featured', 'picks', 'selects']],
  ['Coffee', ['coffee', 'cafe', 'break', 'social']],
  ['Pizza', ['food', 'lunch', 'catering', 'recipes', 'recipe']],
  ['TreePine', ['nature', 'outdoor', 'outdoors', 'forest', 'environment', 'environments']],
  ['Building2', ['office', 'studio', 'company', 'architecture', 'building']],
];

const WORD_TO_ICON = new Map<string, string>();
for (const [icon, words] of RULES) for (const w of words) if (!WORD_TO_ICON.has(w)) WORD_TO_ICON.set(w, icon);

// Icon names themselves are good keywords too ("Rocket launch" → Rocket).
const NAME_TO_ICON = new Map<string, string>();
for (const name of Object.keys(BOARD_ICONS)) {
  for (const part of iconLabel(name).split(' ')) if (part.length > 2 && !NAME_TO_ICON.has(part)) NAME_TO_ICON.set(part, name);
}

const words = (title: string) =>
  title.toLowerCase().replace(/r\s*&\s*d/g, 'r&d').split(/[^a-z0-9&]+/).filter(Boolean);

const singular = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Best-guess Lucide icon name for a board title. */
export function guessIcon(title: string): string {
  for (const w of words(title)) {
    const s = singular(w);
    const hit = WORD_TO_ICON.get(w) ?? WORD_TO_ICON.get(s) ?? NAME_TO_ICON.get(w) ?? NAME_TO_ICON.get(s);
    if (hit) return hit;
  }
  return DEFAULT_BOARD_ICON;
}

/** The icon a board shows: its chosen one, or a guess from its name. */
export const effectiveIcon = (b: { icon: string | null; title: string }) => b.icon ?? guessIcon(b.title);
