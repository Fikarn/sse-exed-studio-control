import { assert } from "./native-runtime-harness.mjs";

export async function assertCoreParityContracts(harness, requestIdPrefix, runtimeLabel) {
  const planningTimeReport = await harness.request(`${requestIdPrefix}-planning-time-report`, "planning.report.time");
  assert(
    typeof planningTimeReport.totalSeconds === "number",
    `${runtimeLabel} planning.report.time is missing totalSeconds.`
  );
  assert(
    Array.isArray(planningTimeReport.byProject) && planningTimeReport.byProject.length > 0,
    `${runtimeLabel} planning.report.time must expose at least one project aggregate.`
  );
  assert(Array.isArray(planningTimeReport.byTask), `${runtimeLabel} planning.report.time is missing byTask.`);
  assert(Array.isArray(planningTimeReport.timerEvents), `${runtimeLabel} planning.report.time is missing timerEvents.`);

  const firstProject = planningTimeReport.byProject[0];
  assert(
    typeof firstProject.projectId === "string" &&
      typeof firstProject.title === "string" &&
      typeof firstProject.totalSeconds === "number" &&
      typeof firstProject.taskCount === "number",
    `${runtimeLabel} planning.report.time returned an invalid byProject entry.`
  );

  if (planningTimeReport.byTask.length > 0) {
    const firstTask = planningTimeReport.byTask[0];
    assert(
      typeof firstTask.taskId === "string" &&
        typeof firstTask.taskTitle === "string" &&
        typeof firstTask.projectId === "string" &&
        typeof firstTask.projectTitle === "string" &&
        typeof firstTask.totalSeconds === "number",
      `${runtimeLabel} planning.report.time returned an invalid byTask entry.`
    );
  }

  const controlSurfaceSnapshot = await harness.request(`${requestIdPrefix}-control-surface`, "controlSurface.snapshot");
  assert(
    Array.isArray(controlSurfaceSnapshot.pages) && controlSurfaceSnapshot.pages.length === 4,
    `${runtimeLabel} controlSurface.snapshot must expose the four legacy page groups.`
  );
  assert(
    controlSurfaceSnapshot.pages.some((page) => page.label === "PROJECTS") &&
      controlSurfaceSnapshot.pages.some((page) => page.label === "AUDIO"),
    `${runtimeLabel} controlSurface.snapshot is missing expected page labels.`
  );

  const projectsPage = controlSurfaceSnapshot.pages.find((page) => page.label === "PROJECTS");
  assert(
    projectsPage && Array.isArray(projectsPage.buttons) && Array.isArray(projectsPage.dials),
    `${runtimeLabel} controlSurface.snapshot returned an invalid PROJECTS page.`
  );
  assert(
    projectsPage.buttons.length > 0 && projectsPage.dials.length > 0,
    `${runtimeLabel} controlSurface.snapshot must expose PROJECTS buttons and dials.`
  );

  const lightingDmxMonitor = await harness.request(
    `${requestIdPrefix}-lighting-dmx-monitor`,
    "lighting.dmxMonitor.snapshot"
  );
  assert(
    Array.isArray(lightingDmxMonitor.channels),
    `${runtimeLabel} lighting.dmxMonitor.snapshot is missing channels.`
  );

  if (lightingDmxMonitor.channels.length > 0) {
    const firstChannel = lightingDmxMonitor.channels[0];
    assert(
      typeof firstChannel.channel === "number" &&
        typeof firstChannel.value === "number" &&
        typeof firstChannel.lightName === "string" &&
        typeof firstChannel.label === "string",
      `${runtimeLabel} lighting.dmxMonitor.snapshot returned an invalid channel entry.`
    );
  }
}

function projectById(snapshot, projectId) {
  return (snapshot.projects ?? []).find((project) => project.id === projectId) ?? null;
}

function taskById(snapshot, taskId) {
  return (snapshot.tasks ?? []).find((task) => task.id === taskId) ?? null;
}

function projectsForStatus(snapshot, status) {
  return (snapshot.projects ?? [])
    .filter((project) => project.status === status)
    .sort((left, right) => left.order - right.order);
}

function lightingFixtureById(snapshot, fixtureId) {
  return (snapshot.fixtures ?? []).find((fixture) => fixture.id === fixtureId) ?? null;
}

function lightingGroupById(snapshot, groupId) {
  return (snapshot.groups ?? []).find((group) => group.id === groupId) ?? null;
}

function lightingSceneById(snapshot, sceneId) {
  return (snapshot.scenes ?? []).find((scene) => scene.id === sceneId) ?? null;
}

function audioChannelById(snapshot, channelId) {
  return (snapshot.channels ?? []).find((channel) => channel.id === channelId) ?? null;
}

function audioMixTargetById(snapshot, mixTargetId) {
  return (snapshot.mixTargets ?? []).find((target) => target.id === mixTargetId) ?? null;
}

export async function assertPlanningWorkflowParity(harness, requestIdPrefix, runtimeLabel) {
  const prioritySettings = await harness.request(
    `${requestIdPrefix}-planning-settings-priority`,
    "planning.settings.update",
    {
      viewFilter: "todo",
      sortBy: "priority",
    }
  );
  assert(
    prioritySettings.settings?.viewFilter === "todo" && prioritySettings.settings?.sortBy === "priority",
    `${runtimeLabel} planning.settings.update did not persist the todo/priority board view.`
  );

  const manualSettings = await harness.request(
    `${requestIdPrefix}-planning-settings-manual`,
    "planning.settings.update",
    {
      viewFilter: "all",
      sortBy: "manual",
    }
  );
  assert(
    manualSettings.settings?.viewFilter === "all" && manualSettings.settings?.sortBy === "manual",
    `${runtimeLabel} planning.settings.update did not restore the all/manual board view.`
  );

  const blockedProject = await harness.request(
    `${requestIdPrefix}-planning-project-reorder-blocked`,
    "planning.project.reorder",
    {
      projectId: "sample-proj-2",
      newStatus: "blocked",
      newIndex: 0,
    }
  );
  assert(
    blockedProject.project?.status === "blocked" && blockedProject.project?.order === 0,
    `${runtimeLabel} planning.project.reorder did not move the sample todo project into the blocked lane.`
  );

  const todoProjectA = await harness.request(`${requestIdPrefix}-planning-project-a`, "planning.project.create", {
    title: "Parity Flow A",
    description: "First temporary project used to verify board ordering parity.",
    status: "todo",
    priority: "p2",
  });
  const todoProjectB = await harness.request(`${requestIdPrefix}-planning-project-b`, "planning.project.create", {
    title: "Parity Flow B",
    description: "Second temporary project used to verify board ordering parity.",
    status: "todo",
    priority: "p2",
  });

  const sameLaneReorder = await harness.request(
    `${requestIdPrefix}-planning-project-reorder-manual`,
    "planning.project.reorder",
    {
      projectId: todoProjectB.project.id,
      newStatus: "todo",
      newIndex: 0,
    }
  );
  assert(
    sameLaneReorder.project?.id === todoProjectB.project.id && sameLaneReorder.project?.order === 0,
    `${runtimeLabel} planning.project.reorder did not move the temporary todo project to the top of its lane.`
  );

  const selectProject = await harness.request(
    `${requestIdPrefix}-planning-select-project`,
    "planning.settings.update",
    {
      selectedProjectId: todoProjectB.project.id,
    }
  );
  assert(
    selectProject.settings?.selectedProjectId === todoProjectB.project.id,
    `${runtimeLabel} planning.settings.update did not select the temporary project for detail work.`
  );

  const taskOne = await harness.request(`${requestIdPrefix}-planning-task-one`, "planning.task.create", {
    projectId: todoProjectB.project.id,
    title: "Parity Task 1",
    description: "Initial task created through the native planning parity gate.",
    priority: "p1",
    dueDate: "2026-04-30",
    labels: ["planning", "native"],
  });
  const taskTwo = await harness.request(`${requestIdPrefix}-planning-task-two`, "planning.task.create", {
    projectId: todoProjectB.project.id,
    title: "Parity Task 2",
    description: "Secondary task used to verify manual task ordering.",
    priority: "p2",
    labels: ["board"],
  });

  assert(
    taskOne.context?.settings?.selectedTaskId === taskOne.task.id &&
      taskTwo.context?.settings?.selectedTaskId === taskTwo.task.id,
    `${runtimeLabel} planning.task.create did not advance selection to the newly created task.`
  );

  const updatedTask = await harness.request(`${requestIdPrefix}-planning-task-update`, "planning.task.update", {
    taskId: taskOne.task.id,
    title: "Parity Task 1 Updated",
    description: "Updated through the native parity acceptance lane.",
    priority: "p0",
    dueDate: "2026-05-01",
    labels: ["planning", "native", "accepted"],
  });
  assert(
    updatedTask.task?.title === "Parity Task 1 Updated" &&
      updatedTask.task?.priority === "p0" &&
      updatedTask.task?.dueDate === "2026-05-01" &&
      Array.isArray(updatedTask.task?.labels) &&
      updatedTask.task.labels.includes("accepted"),
    `${runtimeLabel} planning.task.update did not persist the expected task edits.`
  );

  const reorderedTask = await harness.request(`${requestIdPrefix}-planning-task-reorder`, "planning.task.update", {
    taskId: taskTwo.task.id,
    order: 0,
  });
  assert(
    reorderedTask.task?.id === taskTwo.task.id && reorderedTask.task?.order === 0,
    `${runtimeLabel} planning.task.update did not move the secondary task to the top of the task list.`
  );

  const checklistAdded = await harness.request(
    `${requestIdPrefix}-planning-checklist-add`,
    "planning.task.checklist.add",
    {
      taskId: taskOne.task.id,
      text: "Verify task checklist parity",
    }
  );
  const checklistItem = checklistAdded.task?.checklist?.find((item) => item.text === "Verify task checklist parity");
  assert(checklistItem, `${runtimeLabel} planning.task.checklist.add did not append the new checklist item.`);

  const checklistUpdated = await harness.request(
    `${requestIdPrefix}-planning-checklist-update`,
    "planning.task.checklist.update",
    {
      taskId: taskOne.task.id,
      itemId: checklistItem.id,
      done: true,
    }
  );
  assert(
    checklistUpdated.task?.checklist?.some((item) => item.id === checklistItem.id && item.done),
    `${runtimeLabel} planning.task.checklist.update did not persist checklist completion.`
  );

  const checklistDeleted = await harness.request(
    `${requestIdPrefix}-planning-checklist-delete`,
    "planning.task.checklist.delete",
    {
      taskId: taskOne.task.id,
      itemId: checklistItem.id,
    }
  );
  assert(
    !checklistDeleted.task?.checklist?.some((item) => item.id === checklistItem.id),
    `${runtimeLabel} planning.task.checklist.delete did not remove the checklist item.`
  );

  const timerStarted = await harness.request(`${requestIdPrefix}-planning-task-timer-start`, "planning.task.timer", {
    taskId: taskOne.task.id,
    action: "toggle",
  });
  assert(
    timerStarted.resolvedAction === "start" && timerStarted.task?.isRunning,
    `${runtimeLabel} planning.task.timer did not start the selected task timer.`
  );

  const timerStopped = await harness.request(`${requestIdPrefix}-planning-task-timer-stop`, "planning.task.timer", {
    taskId: taskOne.task.id,
    action: "toggle",
  });
  assert(
    timerStopped.resolvedAction === "stop" && !timerStopped.task?.isRunning,
    `${runtimeLabel} planning.task.timer did not stop the selected task timer.`
  );

  const taskCompleted = await harness.request(
    `${requestIdPrefix}-planning-task-toggle-complete`,
    "planning.task.toggleComplete",
    {
      taskId: taskOne.task.id,
    }
  );
  assert(
    taskCompleted.task?.completed === true,
    `${runtimeLabel} planning.task.toggleComplete did not mark the selected task complete.`
  );

  const taskDeleted = await harness.request(`${requestIdPrefix}-planning-task-delete`, "planning.task.delete", {
    taskId: taskTwo.task.id,
  });
  assert(taskDeleted.deleted === true, `${runtimeLabel} planning.task.delete did not report a successful delete.`);

  const planningSnapshot = await harness.request(
    `${requestIdPrefix}-planning-snapshot-operator-flow`,
    "planning.snapshot"
  );
  const blockedSnapshotProject = projectById(planningSnapshot, "sample-proj-2");
  const temporaryProject = projectById(planningSnapshot, todoProjectB.project.id);
  const updatedSnapshotTask = taskById(planningSnapshot, taskOne.task.id);
  const deletedSnapshotTask = taskById(planningSnapshot, taskTwo.task.id);
  const todoProjectIds = projectsForStatus(planningSnapshot, "todo").map((project) => project.id);

  assert(
    blockedSnapshotProject?.status === "blocked",
    `${runtimeLabel} planning snapshot did not retain the cross-lane project move.`
  );
  assert(
    temporaryProject &&
      todoProjectIds[0] === todoProjectB.project.id &&
      todoProjectIds.includes(todoProjectA.project.id),
    `${runtimeLabel} planning snapshot did not retain the temporary todo lane ordering.`
  );
  assert(
    updatedSnapshotTask?.title === "Parity Task 1 Updated" &&
      updatedSnapshotTask?.completed === true &&
      updatedSnapshotTask?.isRunning === false &&
      updatedSnapshotTask?.projectId === todoProjectB.project.id,
    `${runtimeLabel} planning snapshot did not retain the updated selected task state.`
  );
  assert(deletedSnapshotTask === null, `${runtimeLabel} planning snapshot still contains the deleted temporary task.`);
  assert(
    planningSnapshot.settings?.selectedProjectId === todoProjectB.project.id &&
      planningSnapshot.settings?.sortBy === "manual" &&
      planningSnapshot.settings?.viewFilter === "all",
    `${runtimeLabel} planning snapshot did not retain the expected board settings and selection.`
  );

  return {
    temporaryProjectIds: [todoProjectA.project.id, todoProjectB.project.id],
    temporaryTaskIds: [taskOne.task.id, taskTwo.task.id],
  };
}

export async function assertLightingWorkflowParity(harness, requestIdPrefix, runtimeLabel) {
  const lightingProbe = await harness.request(`${requestIdPrefix}-lighting-probe`, "commissioning.check.run", {
    target: "lighting",
    bridgeIp: "127.0.0.1",
    universe: 1,
  });
  const lightingCheck = lightingProbe.checks?.find((check) => check.id === "lighting");
  assert(
    lightingCheck && typeof lightingCheck.status === "string" && typeof lightingCheck.message === "string",
    `${runtimeLabel} commissioning.check.run did not return a valid lighting bridge probe record.`
  );

  const lightingSettings = await harness.request(`${requestIdPrefix}-lighting-settings`, "lighting.settings.update", {
    enabled: true,
    bridgeIp: "127.0.0.1",
    universe: 1,
    grandMaster: 72,
    cameraMarker: { x: 0.5, y: 0.84, rotation: 0 },
    subjectMarker: { x: 0.5, y: 0.46, rotation: 12 },
  });
  assert(
    lightingSettings.enabled === true &&
      lightingSettings.bridgeIp === "127.0.0.1" &&
      lightingSettings.universe === 1 &&
      lightingSettings.grandMaster === 72,
    `${runtimeLabel} lighting.settings.update did not persist the expected transport and GM state.`
  );
  const enabledLightingSnapshot = await harness.request(
    `${requestIdPrefix}-lighting-snapshot-enabled`,
    "lighting.snapshot"
  );
  // Scene recall is gated by the persisted lighting runtime status, not just the transient probe result.
  const lightingVerified = enabledLightingSnapshot.status === "ready";
  const enabledFixtureCount = enabledLightingSnapshot.fixtures?.length ?? 0;
  const enabledGroupCount = enabledLightingSnapshot.groups?.length ?? 0;
  const enabledSceneCount = enabledLightingSnapshot.scenes?.length ?? 0;

  const temporaryGroup = await harness.request(`${requestIdPrefix}-lighting-group-create`, "lighting.group.create", {
    name: "Parity Lighting Group",
  });
  const renamedGroup = await harness.request(`${requestIdPrefix}-lighting-group-rename`, "lighting.group.update", {
    groupId: temporaryGroup.group.id,
    name: "Parity Lighting Group Renamed",
  });
  assert(
    renamedGroup.group?.name === "Parity Lighting Group Renamed",
    `${runtimeLabel} lighting.group.update did not rename the parity lighting group.`
  );

  const deletedGroup = await harness.request(
    `${requestIdPrefix}-lighting-group-delete-create`,
    "lighting.group.create",
    {
      name: "Delete Lighting Group",
    }
  );
  const deletedGroupResult = await harness.request(
    `${requestIdPrefix}-lighting-group-delete`,
    "lighting.group.delete",
    {
      groupId: deletedGroup.group.id,
    }
  );
  assert(
    deletedGroupResult.deleted === true,
    `${runtimeLabel} lighting.group.delete did not remove the temporary delete-only group.`
  );

  const temporaryFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-create`,
    "lighting.fixture.create",
    {
      name: "Parity Key Light",
      type: "astra-bicolor",
      dmxStartAddress: 481,
      groupId: temporaryGroup.group.id,
    }
  );
  const updatedFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-update`,
    "lighting.fixture.update",
    {
      fixtureId: temporaryFixture.fixture.id,
      on: true,
      intensity: 44,
      cct: 5600,
      effect: { type: "strobe", speed: 4 },
      spatialX: 0.22,
      spatialY: 0.31,
      spatialRotation: 15,
    }
  );
  assert(
    updatedFixture.fixture?.on === true &&
      updatedFixture.fixture?.intensity === 44 &&
      updatedFixture.fixture?.cct === 5600 &&
      updatedFixture.fixture?.effect?.type === "strobe" &&
      updatedFixture.fixture?.effect?.speed === 4 &&
      updatedFixture.fixture?.spatialX === 0.22 &&
      updatedFixture.fixture?.spatialY === 0.31 &&
      updatedFixture.fixture?.spatialRotation === 15,
    `${runtimeLabel} lighting.fixture.update did not persist the expected lighting fixture state.`
  );

  const deletedFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-delete-create`,
    "lighting.fixture.create",
    {
      name: "Delete Light",
      type: "astra-bicolor",
      dmxStartAddress: 489,
      groupId: null,
    }
  );
  const deletedFixtureResult = await harness.request(
    `${requestIdPrefix}-lighting-fixture-delete`,
    "lighting.fixture.delete",
    {
      fixtureId: deletedFixture.fixture.id,
    }
  );
  assert(
    deletedFixtureResult.deleted === true,
    `${runtimeLabel} lighting.fixture.delete did not remove the temporary delete-only fixture.`
  );

  const selectedFixtureSettings = await harness.request(
    `${requestIdPrefix}-lighting-settings-selected-fixture`,
    "lighting.settings.update",
    {
      selectedFixtureId: temporaryFixture.fixture.id,
    }
  );
  assert(
    selectedFixtureSettings.selectedFixtureId === temporaryFixture.fixture.id,
    `${runtimeLabel} lighting.settings.update did not select the temporary lighting fixture.`
  );

  const temporaryScene = await harness.request(`${requestIdPrefix}-lighting-scene-create`, "lighting.scene.create", {
    name: "Parity Lighting Scene",
  });
  const renamedScene = await harness.request(`${requestIdPrefix}-lighting-scene-rename`, "lighting.scene.update", {
    sceneId: temporaryScene.scene.id,
    name: "Parity Lighting Scene Renamed",
  });
  assert(
    renamedScene.scene?.name === "Parity Lighting Scene Renamed",
    `${runtimeLabel} lighting.scene.update did not rename the parity lighting scene.`
  );

  const deletedScene = await harness.request(
    `${requestIdPrefix}-lighting-scene-delete-create`,
    "lighting.scene.create",
    {
      name: "Delete Lighting Scene",
    }
  );
  const deletedSceneResult = await harness.request(
    `${requestIdPrefix}-lighting-scene-delete`,
    "lighting.scene.delete",
    {
      sceneId: deletedScene.scene.id,
    }
  );
  assert(
    deletedSceneResult.deleted === true,
    `${runtimeLabel} lighting.scene.delete did not remove the temporary delete-only scene.`
  );

  const selectSceneSettings = await harness.request(
    `${requestIdPrefix}-lighting-settings-selected-scene`,
    "lighting.settings.update",
    {
      selectedSceneId: temporaryScene.scene.id,
    }
  );
  assert(
    selectSceneSettings.selectedSceneId === temporaryScene.scene.id,
    `${runtimeLabel} lighting.settings.update did not select the temporary lighting scene.`
  );

  const sceneCapture = await harness.request(`${requestIdPrefix}-lighting-scene-capture`, "lighting.scene.update", {
    sceneId: temporaryScene.scene.id,
    captureCurrentState: true,
  });
  assert(
    sceneCapture.scene?.id === temporaryScene.scene.id,
    `${runtimeLabel} lighting.scene.update did not capture current scene state.`
  );

  const mutatedBeforeRecall = await harness.request(
    `${requestIdPrefix}-lighting-fixture-update-before-recall`,
    "lighting.fixture.update",
    {
      fixtureId: temporaryFixture.fixture.id,
      on: false,
      intensity: 88,
      cct: 3200,
    }
  );
  assert(
    mutatedBeforeRecall.fixture?.on === false &&
      mutatedBeforeRecall.fixture?.intensity === 88 &&
      mutatedBeforeRecall.fixture?.cct === 3200,
    `${runtimeLabel} lighting fixture could not be mutated before scene recall validation.`
  );

  if (lightingVerified) {
    const recallScene = await harness.request(`${requestIdPrefix}-lighting-scene-recall`, "lighting.scene.recall", {
      sceneId: temporaryScene.scene.id,
      fadeDurationSeconds: 2,
    });
    assert(
      recallScene.recalled === true && recallScene.sceneId === temporaryScene.scene.id,
      `${runtimeLabel} lighting.scene.recall did not recall the selected scene after the bridge probe passed.`
    );
  }

  const groupPower = await harness.request(`${requestIdPrefix}-lighting-group-power`, "lighting.group.power", {
    groupId: temporaryGroup.group.id,
    on: false,
  });
  assert(
    groupPower.groupId === temporaryGroup.group.id && groupPower.affectedFixtures >= 1,
    `${runtimeLabel} lighting.group.power did not affect the temporary lighting group.`
  );

  const allPower = await harness.request(`${requestIdPrefix}-lighting-all-power`, "lighting.power.all", {
    on: true,
  });
  assert(allPower.affectedFixtures >= 1, `${runtimeLabel} lighting.power.all did not affect any fixtures.`);

  const dmxMonitor = await harness.request(
    `${requestIdPrefix}-lighting-dmx-monitor-live`,
    "lighting.dmxMonitor.snapshot"
  );
  assert(
    dmxMonitor.channels?.some((channel) => channel.lightName === "Parity Key Light"),
    `${runtimeLabel} lighting.dmxMonitor.snapshot did not expose DMX channels for the temporary fixture.`
  );

  const lightingSnapshot = await harness.request(
    `${requestIdPrefix}-lighting-snapshot-operator-flow`,
    "lighting.snapshot"
  );
  const snapshotFixture = lightingFixtureById(lightingSnapshot, temporaryFixture.fixture.id);
  const snapshotGroup = lightingGroupById(lightingSnapshot, temporaryGroup.group.id);
  const snapshotScene = lightingSceneById(lightingSnapshot, temporaryScene.scene.id);
  const expectedFixtureIntensity = lightingVerified ? 44 : 88;
  const expectedFixtureCct = lightingVerified ? 5600 : 3200;

  assert(
    snapshotFixture &&
      snapshotFixture.name === "Parity Key Light" &&
      snapshotFixture.on === true &&
      snapshotFixture.intensity === expectedFixtureIntensity &&
      snapshotFixture.cct === expectedFixtureCct &&
      snapshotFixture.groupId === temporaryGroup.group.id,
    `${runtimeLabel} lighting snapshot did not retain the temporary parity fixture state.`
  );
  assert(
    snapshotGroup?.name === "Parity Lighting Group Renamed",
    `${runtimeLabel} lighting snapshot did not retain the renamed parity group.`
  );
  assert(
    snapshotScene?.name === "Parity Lighting Scene Renamed" &&
      lightingSnapshot.selectedSceneId === temporaryScene.scene.id &&
      lightingSnapshot.selectedFixtureId === temporaryFixture.fixture.id &&
      lightingSnapshot.grandMaster === 72 &&
      lightingSnapshot.cameraMarker?.y === 0.84 &&
      lightingSnapshot.subjectMarker?.rotation === 12,
    `${runtimeLabel} lighting snapshot did not retain the expected selection, GM, or marker state.`
  );
  if (lightingVerified) {
    assert(
      snapshotScene?.lastRecalled === true,
      `${runtimeLabel} lighting snapshot did not retain the recalled-scene marker after verification passed.`
    );
  } else {
    assert(
      enabledLightingSnapshot.status === "not-verified" ||
        enabledLightingSnapshot.status === "attention" ||
        enabledLightingSnapshot.status === "disabled",
      `${runtimeLabel} lighting snapshot reported unexpected non-ready status '${enabledLightingSnapshot.status}' after the commissioning probe returned '${lightingCheck.status}'.`
    );
  }
  assert(
    lightingSnapshot.fixtures?.length === enabledFixtureCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator fixture on top of the enabled inventory.`
  );
  assert(
    lightingSnapshot.groups?.length === enabledGroupCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator group on top of the enabled inventory.`
  );
  assert(
    lightingSnapshot.scenes?.length === enabledSceneCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator scene on top of the enabled inventory.`
  );
  assert(
    lightingFixtureById(lightingSnapshot, deletedFixture.fixture.id) === null &&
      lightingGroupById(lightingSnapshot, deletedGroup.group.id) === null &&
      lightingSceneById(lightingSnapshot, deletedScene.scene.id) === null,
    `${runtimeLabel} lighting snapshot still contains delete-only parity entities.`
  );

  return {
    lightingVerified,
    temporaryFixtureIds: [temporaryFixture.fixture.id, deletedFixture.fixture.id],
    temporaryGroupIds: [temporaryGroup.group.id, deletedGroup.group.id],
    temporarySceneIds: [temporaryScene.scene.id, deletedScene.scene.id],
  };
}

export async function assertAudioWorkflowParity(harness, requestIdPrefix, runtimeLabel) {
  const baselineSnapshot = await harness.request(`${requestIdPrefix}-audio-snapshot-baseline`, "audio.snapshot");
  const baselineFront = audioChannelById(baselineSnapshot, "audio-input-12");
  const baselineMainMix = audioMixTargetById(baselineSnapshot, "audio-mix-main");
  const baselinePlayback = audioChannelById(baselineSnapshot, "audio-playback-1-2");

  assert(baselineFront, `${runtimeLabel} audio.snapshot is missing front preamp audio-input-12.`);
  assert(baselineMainMix, `${runtimeLabel} audio.snapshot is missing audio-mix-main.`);
  assert(baselinePlayback, `${runtimeLabel} audio.snapshot is missing audio-playback-1-2.`);

  const settings = await harness.request(`${requestIdPrefix}-audio-settings`, "audio.settings.update", {
    selectedChannelId: "audio-input-12",
    selectedMixTargetId: "audio-mix-phones-a",
    expectedPeakData: false,
    expectedSubmixLock: false,
    expectedCompatibilityMode: true,
  });
  assert(
    settings.selectedChannelId === "audio-input-12" &&
      settings.selectedMixTargetId === "audio-mix-phones-a" &&
      settings.expectedPeakData === false &&
      settings.expectedSubmixLock === false &&
      settings.expectedCompatibilityMode === true,
    `${runtimeLabel} audio.settings.update did not retain the expected operator selection and transport settings.`
  );

  const updatedMainMix = await harness.request(`${requestIdPrefix}-audio-mix-main`, "audio.mixTarget.update", {
    mixTargetId: "audio-mix-main",
    volume: 0.81,
    dim: true,
    mono: true,
    talkback: true,
  });
  assert(
    updatedMainMix.id === "audio-mix-main" &&
      updatedMainMix.volume === 0.81 &&
      updatedMainMix.dim === true &&
      updatedMainMix.mono === true &&
      updatedMainMix.talkback === true,
    `${runtimeLabel} audio.mixTarget.update did not persist the expected control-room mix state.`
  );

  const updatedFront = await harness.request(`${requestIdPrefix}-audio-front-preamp`, "audio.channel.update", {
    channelId: "audio-input-12",
    gain: 40,
    phantom: true,
    instrument: true,
    autoSet: true,
    phase: true,
  });
  assert(
    updatedFront.id === "audio-input-12" &&
      updatedFront.gain === 40 &&
      updatedFront.phantom === true &&
      updatedFront.pad === baselineFront.pad &&
      updatedFront.instrument === true &&
      updatedFront.autoSet === true &&
      updatedFront.phase === true,
    `${runtimeLabel} audio.channel.update did not persist the expected writable front-preamp controls.`
  );

  const updatedRear = await harness.request(`${requestIdPrefix}-audio-rear-line`, "audio.channel.update", {
    channelId: "audio-input-1",
    mute: true,
    phase: true,
  });
  assert(
    updatedRear.id === "audio-input-1" && updatedRear.mute === true && updatedRear.phase === true,
    `${runtimeLabel} audio.channel.update did not persist the expected rear-line operator state.`
  );

  const updatedPlayback = await harness.request(`${requestIdPrefix}-audio-playback`, "audio.channel.update", {
    channelId: "audio-playback-1-2",
    fader: 0.61,
    mixTargetId: "audio-mix-phones-a",
    mute: true,
    solo: true,
  });
  assert(
    updatedPlayback.id === "audio-playback-1-2" &&
      updatedPlayback.fader === 0.61 &&
      updatedPlayback.mute === true &&
      updatedPlayback.solo === true &&
      updatedPlayback.mixLevels?.["audio-mix-phones-a"] === 0.61,
    `${runtimeLabel} audio.channel.update did not persist the expected playback send state.`
  );

  let unsupportedFieldRejected = false;
  try {
    await harness.request(`${requestIdPrefix}-audio-rear-line-unsupported`, "audio.channel.update", {
      channelId: "audio-input-1",
      phantom: true,
    });
  } catch (error) {
    unsupportedFieldRejected = String(error.message).includes("AUDIO_CHANNEL_FIELD_UNSUPPORTED");
  }
  assert(
    unsupportedFieldRejected,
    `${runtimeLabel} audio role-gating did not reject unsupported rear-line phantom changes.`
  );

  const audioProbe = await harness.request(`${requestIdPrefix}-audio-probe`, "commissioning.check.run", {
    target: "audio",
    sendHost: settings.sendHost,
    sendPort: settings.sendPort,
    receivePort: settings.receivePort,
  });
  const audioCheck = audioProbe.checks?.find((check) => check.id === "audio");
  assert(
    audioCheck && typeof audioCheck.status === "string" && typeof audioCheck.message === "string",
    `${runtimeLabel} commissioning.check.run did not return a valid audio probe record.`
  );
  const audioProbeBindDenied =
    audioCheck.status === "failed" &&
    /could not bind receive port/i.test(audioCheck.message) &&
    /operation not permitted/i.test(audioCheck.message);

  // CI escape: stock GitHub runners have no RME TotalMix OSC source, so the
  // probe successfully binds 7001/9001 but never receives meter packets and
  // fails with "No RME TotalMix OSC meter packets were received…". The
  // `audioProbeBindDenied` escape above only covers sandboxed-bind failures,
  // not the no-traffic case. Operators set this env var in their CI workflow
  // (see `.github/workflows/dev-checks.yml` `native-acceptance` job) to drop
  // only the audio.sync / audio.snapshot.recall assertions; the rest of the
  // harness (import → backup → restart → workflow parity → restore → verify
  // rollback) still runs end-to-end. Local laptop runs without the env var
  // continue to require live TotalMix exactly as before.
  const skipAudioSync = process.env.SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC === "1";

  if (!audioProbeBindDenied && !skipAudioSync) {
    assert(
      audioCheck.status === "passed",
      `${runtimeLabel} commissioning audio probe did not pass before sync/recall validation: ${audioCheck.message}`
    );

    const synced = await harness.request(`${requestIdPrefix}-audio-sync`, "audio.sync");
    assert(
      synced.synced === true && synced.consoleStateConfidence === "aligned",
      `${runtimeLabel} audio.sync did not report an aligned console state.`
    );

    const recalled = await harness.request(`${requestIdPrefix}-audio-snapshot-recall`, "audio.snapshot.recall", {
      snapshotId: "snapshot-panel",
    });
    assert(
      recalled.recalled === true &&
        recalled.snapshotId === "snapshot-panel" &&
        recalled.consoleStateConfidence === "assumed",
      `${runtimeLabel} audio.snapshot.recall did not move the console back into the expected assumed state.`
    );
  }

  const mutatedSnapshot = await harness.request(`${requestIdPrefix}-audio-snapshot-mutated`, "audio.snapshot");
  const mutatedFront = audioChannelById(mutatedSnapshot, "audio-input-12");
  const mutatedRear = audioChannelById(mutatedSnapshot, "audio-input-1");
  const mutatedPlayback = audioChannelById(mutatedSnapshot, "audio-playback-1-2");
  const mutatedMainMix = audioMixTargetById(mutatedSnapshot, "audio-mix-main");

  assert(
    mutatedSnapshot.selectedChannelId === "audio-input-12" &&
      mutatedSnapshot.selectedMixTargetId === "audio-mix-phones-a" &&
      // `skipAudioSync` mirrors the bind-denied skip path because both bypass
      // the audio.sync + audio.snapshot.recall block above.
      mutatedSnapshot.consoleStateConfidence === (audioProbeBindDenied || skipAudioSync ? "aligned" : "assumed") &&
      mutatedSnapshot.lastConsoleSyncReason === (audioProbeBindDenied || skipAudioSync ? null : "snapshot") &&
      mutatedSnapshot.lastRecalledSnapshotId === (audioProbeBindDenied || skipAudioSync ? null : "snapshot-panel"),
    `${runtimeLabel} audio snapshot did not retain the expected selection and recall markers.`
  );
  assert(
    mutatedFront &&
      mutatedFront.gain === 40 &&
      mutatedFront.phantom === true &&
      mutatedFront.pad === baselineFront.pad &&
      mutatedFront.instrument === true &&
      mutatedFront.autoSet === true &&
      mutatedFront.phase === true,
    `${runtimeLabel} audio snapshot did not retain the expected front-preamp state.`
  );
  assert(
    mutatedRear && mutatedRear.mute === true && mutatedRear.phase === true,
    `${runtimeLabel} audio snapshot did not retain the expected rear-line state.`
  );
  assert(
    mutatedPlayback &&
      mutatedPlayback.mute === true &&
      mutatedPlayback.solo === true &&
      mutatedPlayback.mixLevels?.["audio-mix-phones-a"] === 0.61,
    `${runtimeLabel} audio snapshot did not retain the expected playback send state.`
  );
  assert(
    mutatedMainMix &&
      mutatedMainMix.volume === 0.81 &&
      mutatedMainMix.dim === true &&
      mutatedMainMix.mono === true &&
      mutatedMainMix.talkback === true,
    `${runtimeLabel} audio snapshot did not retain the expected control-room state.`
  );

  return {
    baselineFront,
    baselineMainMix,
    baselinePlayback,
    baselineSelectedChannelId: baselineSnapshot.selectedChannelId,
    baselineSelectedMixTargetId: baselineSnapshot.selectedMixTargetId,
    baselineExpectedPeakData: baselineSnapshot.expectedPeakData,
    baselineExpectedSubmixLock: baselineSnapshot.expectedSubmixLock,
    baselineExpectedCompatibilityMode: baselineSnapshot.expectedCompatibilityMode,
    baselineLastConsoleSyncAt: baselineSnapshot.lastConsoleSyncAt ?? null,
    baselineLastConsoleSyncReason: baselineSnapshot.lastConsoleSyncReason ?? null,
    baselineLastRecalledSnapshotId: baselineSnapshot.lastRecalledSnapshotId ?? null,
    baselineLastSnapshotRecallAt: baselineSnapshot.lastSnapshotRecallAt ?? null,
    baselineConsoleStateConfidence: baselineSnapshot.consoleStateConfidence,
  };
}
