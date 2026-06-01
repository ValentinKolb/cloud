import { type PageParams, type Paginated, paginate } from "@valentinkolb/stdlib";

export const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  return {
    items: items.slice(offset, offset + perPage),
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};
