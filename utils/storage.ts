import { Paths, getInfoAsync, readAsStringAsync, writeAsStringAsync } from 'expo-file-system';

export interface ProjectClip {
  uri: string;
  trimStart: number;
  trimEnd: number;
  duration: number;
  width: number;
  height: number;
  thumbnails: string[];
  hasAudio: boolean;
}

export interface ProjectSettings {
  speed: number;
  brightness: number;
  contrast: number;
  saturation: number;
  aspectRatio: string;
  musicUri?: string | null;
  musicName?: string | null;
  videoVolume?: number;
  musicVolume?: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  clips: ProjectClip[];
  settings: ProjectSettings;
}

const PROJECTS_FILE = `${Paths.document.uri}projects.json`;
const MAX_PROJECTS = 20;

export const getProjects = async (): Promise<Project[]> => {
  try {
    const fileInfo = await getInfoAsync(PROJECTS_FILE);
    if (!fileInfo.exists) {
      return [];
    }
    const content = await readAsStringAsync(PROJECTS_FILE);
    return JSON.parse(content) as Project[];
  } catch (error) {
    console.error('Error reading projects:', error);
    return [];
  }
};

export const getProject = async (id: string): Promise<Project | null> => {
  const projects = await getProjects();
  return projects.find((p) => p.id === id) || null;
};

export const saveProject = async (project: Project): Promise<void> => {
  try {
    const projects = await getProjects();
    const existingIndex = projects.findIndex((p) => p.id === project.id);

    project.updatedAt = Date.now();

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);

    const trimmed = projects.slice(0, MAX_PROJECTS);

    await writeAsStringAsync(PROJECTS_FILE, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Error saving project:', error);
  }
};

export const deleteProject = async (id: string): Promise<void> => {
  try {
    const projects = await getProjects();
    const filtered = projects.filter((p) => p.id !== id);
    await writeAsStringAsync(PROJECTS_FILE, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting project:', error);
  }
};
