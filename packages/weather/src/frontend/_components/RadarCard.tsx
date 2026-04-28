// DWD Germany-wide radar GIF
const DWD_RADAR_URL = "https://www.dwd.de/DWD/wetter/radar/radfilm_brd_akt.gif";

type RadarCardProps = {
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Custom max height class (e.g., "max-h-64") */
  maxHeight?: string;
};

const sizeClasses = {
  sm: {
    legend: "text-[8px]",
    source: "text-[8px]",
    bar: "h-1.5",
  },
  md: {
    legend: "text-[10px]",
    source: "text-[10px]",
    bar: "h-2",
  },
  lg: {
    legend: "text-xs",
    source: "text-xs",
    bar: "h-2.5",
  },
};

export default function RadarCard({ showLegend = true, size = "md", maxHeight }: RadarCardProps) {
  const s = sizeClasses[size];

  return (
    <div class="flex flex-col h-full">
      <div class={`bg-zinc-100 dark:bg-zinc-800 thumbnail flex-1 ${maxHeight ?? ""}`}>
        <img
          src={DWD_RADAR_URL}
          alt="Rain radar animation for Germany showing precipitation"
          class="w-full h-full object-contain"
          loading="lazy"
        />
      </div>

      {showLegend && (
        <>
          <div class="mt-2" role="img" aria-label="Precipitation intensity legend">
            <div class={`flex ${s.bar} rounded overflow-hidden`}>
              <div class="flex-1 bg-cyan-400" />
              <div class="flex-1 bg-green-600" />
              <div class="flex-1 bg-green-400" />
              <div class="flex-1 bg-yellow-400" />
              <div class="flex-1 bg-orange-500" />
              <div class="flex-1 bg-red-500" />
              <div class="flex-1 bg-purple-600" />
              <div class="flex-1 bg-blue-900" />
            </div>
            <div class={`flex justify-between ${s.legend} text-dimmed mt-1`}>
              <span>Light</span>
              <span>Moderate</span>
              <span>Heavy</span>
              <span>Extreme</span>
            </div>
          </div>
          <p class={`${s.source} text-dimmed mt-1 text-center`}>Germany &bull; DWD</p>
        </>
      )}
    </div>
  );
}
