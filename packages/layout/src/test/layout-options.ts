import { PAGE_SIZES, type LayoutOptions } from '../index';

export const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};
export const continuous: LayoutOptions = { ...paged, mode: 'continuous', width: 1200 };
