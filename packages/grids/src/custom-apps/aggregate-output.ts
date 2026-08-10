export const customAppAggregateOutputKey = (fieldId: string | "*", aggregate: string): string => `${fieldId}__${aggregate}`;
