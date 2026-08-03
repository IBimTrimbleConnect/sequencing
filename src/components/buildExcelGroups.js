import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

import {
  convertLengthFromMm,
  convertMassFromKg,
  formatCog,
  DEFAULT_FORMATTING,
} from "../utils/projectFormatting";

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
];

export const parseObjectDate = (value) => {
  if (!value) return null;
  if (dayjs.isDayjs(value)) return value.isValid() ? value : null;

  const strictDate = dayjs(value, DATE_FORMATS, true);
  if (strictDate.isValid()) return strictDate;

  const normalDate = dayjs(value);
  return normalDate.isValid() ? normalDate : null;
};

const buildExportItem = (obj, formatting) => {
  const cog = Array.isArray(obj.cog) ? obj.cog : [];

  return {
    AsmName: obj.name || obj.asmName || "",
    AsmPos: obj.asmPos || "",
    MainProfile: obj.profile || obj.mainProfile || "",
    GridPos:
      obj.positionCode || obj.gridPos || obj.location || "",
    Length:
      obj.length != null && Number.isFinite(Number(obj.length))
        ? convertLengthFromMm(obj.length, formatting)
        : "",
    Weight:
      obj.weight != null && Number.isFinite(Number(obj.weight))
        ? convertMassFromKg(obj.weight, formatting)
        : "",
    Cog: formatCog(obj.cog, formatting),
    CogX:
      cog.length >= 3
        ? convertLengthFromMm(cog[0], formatting)
        : "",
    CogY:
      cog.length >= 3
        ? convertLengthFromMm(cog[1], formatting)
        : "",
    CogZ:
      cog.length >= 3
        ? convertLengthFromMm(cog[2], formatting)
        : "",
    Comment: obj.comment || "",
  };
};

export const buildGroups = ({
  plans = [],
  sequenceObjects = [],
  selectedPlanIds = [],
  startDateValue = null,
  endDateValue = null,
  formatting = DEFAULT_FORMATTING,
}) => {
  const selectedPlanIdSet = new Set(
    selectedPlanIds.map(String),
  );

  const start = startDateValue
    ? dayjs(startDateValue).startOf("day")
    : null;

  const end = endDateValue
    ? dayjs(endDateValue).endOf("day")
    : null;

  const planGroups = new Map();

  sequenceObjects.forEach((group) => {
    if (!group) return;

    const groupPlanId = String(group.planId || "");
    if (!selectedPlanIdSet.has(groupPlanId)) return;

    const plan = plans.find(
      (item) => String(item.id) === groupPlanId,
    );

    const planId = String(group.planId || plan?.id || "no-plan");
    const planName = plan?.name || group.planName || "No Plan";

    (group.objects || []).forEach((obj) => {
      const objDate = parseObjectDate(obj.date || obj.assignedDate);
      if (!objDate) return;
      if (start && objDate.isBefore(start, "day")) return;
      if (end && objDate.isAfter(end, "day")) return;

      if (!planGroups.has(planId)) {
        planGroups.set(planId, {
          planId,
          planName,
          planOrder: plans.findIndex(
            (item) => String(item.id) === planId,
          ),
          dates: new Map(),
        });
      }

      const currentPlan = planGroups.get(planId);
      const dateKey = objDate.format("DD-MM-YYYY");

      if (!currentPlan.dates.has(dateKey)) {
        currentPlan.dates.set(dateKey, []);
      }

      currentPlan.dates
        .get(dateKey)
        .push(buildExportItem(obj, formatting));
    });
  });

  return Array.from(planGroups.values())
    .map((plan) => ({
      planId: plan.planId,
      planName: plan.planName,
      planOrder: plan.planOrder,
      groups: Array.from(plan.dates.entries())
        .sort(
          ([a], [b]) =>
            dayjs(a, "DD-MM-YYYY", true).valueOf() -
            dayjs(b, "DD-MM-YYYY", true).valueOf(),
        )
        .map(([date, items]) => ({ date, items })),
    }))
    .filter((plan) => plan.groups.length > 0)
    .sort((a, b) => {
      const orderA =
        a.planOrder >= 0 ? a.planOrder : Number.MAX_SAFE_INTEGER;
      const orderB =
        b.planOrder >= 0 ? b.planOrder : Number.MAX_SAFE_INTEGER;

      return orderA - orderB;
    });
};
