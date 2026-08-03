export const getInternalObjectId = (obj) =>
  obj?.objectId ?? obj?.id ?? null;

export const findSequenceObjectByInternalId = ({
  sequenceObjects,
  modelId,
  objectId,
}) => {
  for (const group of sequenceObjects || []) {
    const object = (group?.objects || []).find((item) => {
      const itemModelId = item.modelId ?? group.modelId;

      return (
        String(itemModelId) === String(modelId) &&
        String(getInternalObjectId(item)) === String(objectId)
      );
    });

    if (object) {
      return {
        object,
        planId: group.planId ?? group.id ?? object.planId,
        subPlanId: group.subPlanId ?? object.subPlanId,
        modelId,
        objectId: getInternalObjectId(object),
      };
    }
  }

  return null;
};

export const getFirstSelectedInternalObject = async (tcapi) => {
  const selections = await tcapi.viewer.getSelection();

  const modelId = selections?.[0]?.modelId;
  const runtimeId = selections?.[0]?.objectRuntimeIds?.[0];

  if (modelId == null || runtimeId == null) {
    return null;
  }

  const objectIds =
    await tcapi.viewer.convertToObjectIds(
      modelId,
      [runtimeId],
    );

  const objectId = objectIds?.[0];

  if (objectId == null) {
    return null;
  }

  return {
    modelId,
    runtimeId,
    objectId,
  };
};
