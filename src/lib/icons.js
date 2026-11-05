// Curated board icons from Lucide (https://lucide.dev, ISC licence): plain
// monochrome SVG line icons. Imported by name so only these end up in the
// bundle. Boards store the icon's name.
import { Activity, AlarmClock, Anchor, Aperture, Archive, AtSign, Atom, AudioLines, Award, Bell, Bird, BookOpen, Bookmark, Box, Briefcase, Brush, Bug, Building2, Calendar, Camera, Car, Cat, ChartBar, ChartPie, Circle, CircleUser, Clapperboard, Clipboard, ClipboardCheck, Clock, Cloud, Code, Coffee, Compass, Cpu, CreditCard, Crop, Crosshair, Crown, Database, Diamond, Dices, Dna, Dog, DollarSign, Drama, Eye, Feather, FileText, Files, Film, Fish, Flag, FlaskConical, Flame, Focus, Folder, FolderOpen, Frame, Gamepad2, Gem, Ghost, Gift, Glasses, Globe, GraduationCap, Grid3x3, Hammer, Hash, Headphones, Heart, HeartPulse, Hexagon, Hourglass, House, Image, Images, Inbox, Infinity, Kanban, Key, Layers, LayoutDashboard, LayoutGrid, Leaf, Lightbulb, Link, ListChecks, Lock, Mail, Map, MapPin, Medal, Megaphone, MessageSquare, MessagesSquare, Mic, MonitorPlay, Moon, Mountain, Music, Newspaper, Package, Palette, Paperclip, PenTool, Pencil, Pizza, Plane, Play, Podcast, Popcorn, Presentation, Projector, Puzzle, Radio, Rocket, Satellite, ScanEye, Scissors, Search, Send, Server, Settings, Shapes, Shield, Ship, Shirt, ShoppingCart, Skull, Smile, Sparkles, Square, SquareCheck, Star, Store, Sun, SwatchBook, Tag, Target, Terminal, Theater, Ticket, Timer, TreePine, TrendingUp, Triangle, Trophy, Truck, Tv, Type, Umbrella, User, Users, Video, WandSparkles, Waves, Wrench, Zap, } from 'lucide-react';
/** Ordered roughly by relevance to a film/video team, then everything else. */
export const BOARD_ICONS = {
    Film, Clapperboard, Video, Camera, Projector, MonitorPlay, Tv, Play, Aperture, Focus, ScanEye,
    Image, Images, Frame, Crop, Scissors, Layers, Palette, SwatchBook, Brush, PenTool, Pencil, Type,
    WandSparkles, Sparkles, Music, AudioLines, Mic, Headphones, Radio, Podcast, Drama, Theater,
    Popcorn, Ticket, Presentation, Kanban, LayoutGrid, LayoutDashboard, ListChecks, SquareCheck,
    ClipboardCheck, Clipboard, Calendar, Clock, Timer, Hourglass, AlarmClock, Bell, Flag, Star,
    Heart, Bookmark, Tag, Folder, FolderOpen, Archive, Inbox, Box, Package, FileText, Files,
    Paperclip, Link, MessageSquare, MessagesSquare, Mail, Send, Megaphone, Newspaper, Users, User,
    CircleUser, Briefcase, Building2, House, Store, MapPin, Map, Globe, Compass, Rocket, Plane, Car,
    Ship, Truck, Lightbulb, Zap, Flame, Sun, Moon, Cloud, Umbrella, Leaf, TreePine, Mountain, Waves,
    Coffee, Pizza, Shirt, Gift, Trophy, Award, Medal, Crown, Gem, Diamond, Target, Crosshair, Eye, Glasses,
    Search, Lock, Key, Shield, Settings, Wrench, Hammer, Cpu, Code, Terminal, Database, Server,
    Satellite, Gamepad2, Puzzle, Dices, Ghost, Skull, Smile, Cat, Dog, Bird, Fish, Bug, Feather,
    Anchor, Infinity, Hexagon, Triangle, Circle, Square, Shapes, Grid3x3, Hash, AtSign, BookOpen,
    GraduationCap, FlaskConical, Atom, Dna, HeartPulse, Activity, ChartBar, ChartPie, TrendingUp,
    DollarSign, ShoppingCart, CreditCard,
};
export const DEFAULT_BOARD_ICON = 'LayoutGrid';
export function boardIcon(name) {
    return (name && BOARD_ICONS[name]) || BOARD_ICONS[DEFAULT_BOARD_ICON];
}
/** "MonitorPlay" -> "monitor play", for search and labels. */
export const iconLabel = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
