export const getTempColorClass = (temp: number): string => {
  if (temp <= 0) return "text-blue-400";
  if (temp <= 10) return "text-cyan-500";
  if (temp <= 20) return "text-emerald-500";
  if (temp <= 25) return "text-amber-500";
  return "text-red-500";
};

export const getAvgTempColorClass = (tempMin: number, tempMax: number): string => getTempColorClass((tempMin + tempMax) / 2);

export const formatTemp = (temp: number): string => `${temp}${String.fromCharCode(176)}`;
