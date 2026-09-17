import { createContext } from 'react';

/* Workspace-wide tile display (Master Settings → Workspace). When provided,
 * `sparklines` decides for every KPI tile whether it draws its mini graph,
 * over the page's own choice. */
export const TileDisplayContext = createContext(null);
