import type { Context } from "hono";
import type { SessionUser, Priority } from "@/spaces/contracts";
import { spacesService, type TaskItem } from "../service";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { parseWidgetSettings, DEFAULT_WIDGET_SETTINGS } from "@/spaces/frontend/[id]/_components/settings/SpaceSettingsStore";
import type { Widget } from "@valentinkolb/cloud/contracts/app"; // =============================================================================
// Helpers
const priorityConfig: Record<Priority, { icon: string; color: string; label: string }> = {
  urgent: { icon: "ti-alert-octagon-filled", color: "text-red-500", label: "Urgent" },
  high: { icon: "ti-alert-triangle-filled", color: "text-orange-500", label: "High" },
  medium: { icon: "ti-alert-circle-filled", color: "text-yellow-500", label: "Medium" },
  low: { icon: "ti-info-circle-filled", color: "text-blue-500", label: "Low" },
}; /** Check if deadline is overdue */
function isOverdue(deadline: string): boolean {
  return new Date(deadline) < new Date();
} /** Check if deadline is today */
function isToday(deadline: string): boolean {
  const today = new Date();
  const deadlineDate = new Date(deadline);
  return deadlineDate.toDateString() === today.toDateString();
} /** Format priority filter for display */
function formatPriorityFilter(priority: Priority | null): string {
  if (!priority) return "All priorities";
  return `${priorityConfig[priority].label}+`;
} // =============================================================================
// Components
function TaskItemRow({ task }: { task: TaskItem }) {
  const overdue = task.deadline && isOverdue(task.deadline);
  const today = task.deadline && isToday(task.deadline);
  const priority = task.priority ? priorityConfig[task.priority] : null;
  return (
    <a
      href={`/app/spaces/${task.spaceId}?item=${task.id}`}
      class="flex items-start gap-2 p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors group"
    >
      {" "}
      {/* Priority/checkbox indicator */}{" "}
      <div class="mt-0.5 shrink-0">
        {" "}
        {priority ? (
          <i class={`ti ${priority.icon} ${priority.color}`} title={priority.label} />
        ) : (
          <i class="ti ti-circle text-dimmed" />
        )}{" "}
      </div>{" "}
      {/* Content */}{" "}
      <div class="flex-1 min-w-0">
        {" "}
        <span class="text-sm text-primary truncate block group-hover:text-blue-600 dark:group-hover:text-blue-400">{task.title}</span>{" "}
        <div class="flex items-center gap-2 text-xs mt-0.5">
          {" "}
          {task.deadline && (
            <span class={`shrink-0 whitespace-nowrap ${overdue ? "text-red-500 font-medium" : today ? "text-orange-500" : "text-dimmed"}`}>
              {" "}
              <i class="ti ti-clock text-[10px] mr-0.5" /> {dates.formatDateRelative(task.deadline)}{" "}
            </span>
          )}{" "}
          <span class="text-zinc-300 dark:text-zinc-600 shrink-0">·</span>{" "}
          <div class="flex items-center gap-1 min-w-0">
            {" "}
            <div class="w-2 h-2 rounded-full shrink-0" style={`background-color: ${task.spaceColor}`} />{" "}
            <span class="text-dimmed truncate">{task.spaceName}</span>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </a>
  );
}
function TasksContent({ tasks }: { tasks: TaskItem[] }) {
  if (tasks.length === 0) {
    return (
      <div class="flex-1 flex items-center justify-center text-dimmed text-xs gap-2">
        {" "}
        <i class="ti ti-checkbox text-sm" /> <span>No tasks assigned to you</span>{" "}
      </div>
    );
  }
  return (
    <div class="flex-1 overflow-y-auto -mx-2">
      {" "}
      <div class="flex flex-col gap-0.5">
        {" "}
        {tasks.map((task) => (
          <TaskItemRow task={task} />
        ))}{" "}
      </div>{" "}
    </div>
  );
} // =============================================================================
// Widget Factory
// ============================================================================= /** * Create my tasks widget. * Shows tasks assigned to the current user. * Settings are configured in Space Settings sidebar. */
export async function createMyTasksWidget(c: Context, user?: SessionUser): Promise<Widget> {
  if (!user) return null;
  const cookieHeader = c.req.header("Cookie");
  const widgetSettings = parseWidgetSettings(cookieHeader);
  const minPriority = widgetSettings.tasksMinPriority;
  const tasks = await spacesService.item.tasks.listMine({
    userId: user.id,
    groups: user.memberofGroup,
    minPriority: minPriority ?? undefined,
    limit: 15,
  });
  return {
    id: "my-tasks",
    title: "My Tasks",
    icon: "checkbox",
    content: (
      <div class="flex flex-col gap-2 flex-1 min-h-0">
        {" "}
        <div class="flex items-center justify-between -mt-1">
          {" "}
          <span class="text-xs text-dimmed">{formatPriorityFilter(minPriority)}</span>{" "}
        </div>{" "}
        <TasksContent tasks={tasks} />{" "}
      </div>
    ),
  };
}
