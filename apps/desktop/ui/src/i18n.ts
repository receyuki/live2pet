export type Locale = 'en' | 'zh-CN';

const messages = {
  en: {
    appName: 'Live2Pet',
    setupEyebrow: 'First-time setup', setupTitle: 'Bring your models to life.', setupBody: 'Add the Live2D runtimes you already own. Live2Pet keeps a private local copy and automatically chooses the compatible generation later.',
    setupRuntime: 'Runtime library', setupEmpty: 'No runtimes saved yet', setupSkip: 'Set up later', setupContinue: 'Continue to Live2Pet', addRuntime: 'Add runtime', replaceRuntime: 'Add or replace', removeAll: 'Remove all',
    welcomeEyebrow: 'Your animation workspace', welcomeTitle: 'Turn Live2D motions into desktop pets.', welcomeBody: 'Import once, preview every Motion, confirm the Motion Mapping, and build a ready-to-install Pet Package.', importSource: 'Import Source Package', importFolder: 'Live2D folder', importPck: 'Destiny Child PCK', importHint: 'Choose a model folder or a supported PCK file.', sourcePathUnavailable: 'Live2Pet could not read the selected local path.', openProject: 'Open project', sampleProject: 'Open design preview', recent: 'Recent projects', noRecent: 'Your recent projects will appear here.', petPackage: 'Pet Package', clawdPackage: 'Clawd Theme Package', codexPackage: 'Codex Pet Package',
    source: 'Source', map: 'Map', build: 'Build', settings: 'Settings', close: 'Done', project: 'Saint Louis · Preview project', saved: 'All changes saved locally',
    motions: 'Motion & Expression', expressions: 'Expressions', preview: 'Live2D Preview', assignment: 'Assignment', motionsHint: 'Choose an animation to preview and assign.', previewHint: 'Your selected motion appears here.', assignmentHint: 'Apply the selected motion directly to a pet behavior.', selected: 'Selected', play: 'Play motion', assigned: 'Assigned behaviors', assign: 'Assign selected motion', search: 'Search', searchMotions: 'Search motions',
    motionMainOne: 'Main 1', motionMainTwo: 'Main 2', motionTouchHead: 'Touch Head', motionAttention: 'Attention', motionError: 'Error', motionDuration: 'Motion · {value}s',
    expressionDefault: 'Default', expressionSmile: 'Smile', expressionSerious: 'Serious', assignmentIdle: 'Idle', assignmentThinking: 'Thinking', assignmentWorking: 'Working', assignmentAttention: 'Attention', assignmentError: 'Error',
    sourceTitle: 'Source Package', sourceBody: 'Review model compatibility, included motions, expressions, and textures before mapping.', sourceReady: 'Ready for mapping', sourceSummary: 'Cubism 4 · 5 Motions · 3 Expressions', sourceModel: 'Model', sourceTextures: 'Textures', sourceMotions: 'Motions', sourceExpressions: 'Expressions', buildTitle: 'Package Build', buildBody: 'Review Target Profile readiness and generate installable Pet Packages.', ready: 'Ready', buildTheme: 'Build theme', buildPackage: 'Build Pet Package',
    general: 'General', runtimes: 'Runtimes', targets: 'Targets & Installation', storage: 'Storage', settingsTitle: 'Settings', settingsBody: 'App-wide preferences stay separate from each Live2Pet project.', appearance: 'Appearance', language: 'Language', system: 'System', light: 'Light', dark: 'Dark', reopenLastProject: 'Reopen the last project on launch',
    runtimeTitle: 'Live2D runtime library', runtimeBody: 'Saved locally and selected automatically by Cubism generation.', runtimeAvailable: 'Available', runtimeMissing: 'Not configured', generations: 'Cubism {value}',
    targetTitle: 'Installation destinations', targetBody: 'Choose destinations during installation. Build and download never install automatically.', askEveryTime: 'Ask each time',
    storageTitle: 'Build cache', storageBody: 'Captured frames are reused to make repeat builds faster.', cacheEmpty: 'Cache is empty', cacheEntries: '{count} cached items · {size}', clearCache: 'Clear cache',
    designPreview: 'Interface preview', notConnected: 'Desktop services unavailable', loading: 'Loading…', error: 'Something went wrong', retry: 'Try again', confirmRemoveRuntimes: 'Remove every saved Live2D runtime?', confirmClearCache: 'Clear the complete build cache?',
    shellLabel: 'Desktop shell preview', shellBody: 'This preview focuses on first-run setup, full-page Settings, and a more app-like Source / Map / Build workspace.',
    setupReview: 'You can still defer runtime setup and continue with inspection first. When a source package later needs a missing runtime, Live2Pet should route you back to the matching Settings section instead of asking you to reclassify it.',
    recentPreview: 'Recent projects are represented with safe placeholders during the shell migration.',
    summaryOne: 'Welcome, Setup, and Settings are now full-page destinations.',
    summaryTwo: 'Runtime and cache management have moved out of the long mapper document.',
    summaryThree: 'Source, Map, and Build are separated as distinct tasks with one project context.',
    sourcePreviewTitle: 'Source review', sourcePreviewBody: 'Inspect compatibility, resources, and model details before touching mappings.', mapPreviewTitle: 'Motion mapping', mapPreviewBody: 'Use the planned left / center / right workspace to connect motions to behaviors.', buildPreviewTitle: 'Build and install', buildPreviewBody: 'Keep build progress, artifact preview, download, and install in one destination.',
    bridgeTitle: 'Bridge status', bridgeBody: 'The final app will replace the classic mapper gradually instead of rewriting the full workflow at once.',
    sampleMotionOne: 'Main idle cycle', sampleMotionTwo: 'Working stance', sampleMotionThree: 'Touch reaction',
    sampleExpressionOne: 'Base expression', sampleExpressionTwo: 'Smile', sampleExpressionThree: 'Serious',
    chosenMotion: 'Chosen motion', chosenExpression: 'Chosen expression', assignmentEmpty: 'No behavior linked yet',
    targetAssignments: 'Planned target behaviors', targetIdle: 'Idle', targetWork: 'Working', targetTouch: 'Touch reaction',
    buildSummary: 'Build summary', buildSummaryBody: 'This shell keeps package generation explicit and app-like. The next migration step is wiring these panels to the existing mapper and build services.',
    cacheRefresh: 'Refresh cache state',
  },
  'zh-CN': {
    appName: 'Live2Pet',
    setupEyebrow: '首次设置', setupTitle: '让你的模型真正动起来。', setupBody: '添加你已经拥有的 Live2D 运行时。Live2Pet 会在本地私密保存副本，之后自动选择匹配的 Cubism 版本。',
    setupRuntime: '运行时资源库', setupEmpty: '尚未保存运行时', setupSkip: '稍后设置', setupContinue: '进入 Live2Pet', addRuntime: '添加运行时', replaceRuntime: '添加或替换', removeAll: '全部移除',
    welcomeEyebrow: '你的动画工作区', welcomeTitle: '把 Live2D 动作变成桌面宠物。', welcomeBody: '导入一次，逐个预览动作，确认动作映射，然后构建可直接安装的宠物包。', importSource: '导入资源包', importFolder: 'Live2D 文件夹', importPck: 'Destiny Child PCK', importHint: '选择模型文件夹或受支持的 PCK 文件。', sourcePathUnavailable: 'Live2Pet 无法读取所选的本地路径。', openProject: '打开项目', sampleProject: '打开设计预览', recent: '最近项目', noRecent: '打开过的项目会显示在这里。', petPackage: '宠物包', clawdPackage: 'Clawd 主题包', codexPackage: 'Codex 宠物包',
    source: '资源', map: '映射', build: '构建', settings: '设置', close: '完成', project: 'Saint Louis · 预览项目', saved: '所有更改均已保存在本地',
    motions: '动作与表情', expressions: '表情', preview: 'Live2D 预览', assignment: '目标配置', motionsHint: '选择一个动画进行预览和配置。', previewHint: '当前选择的动作会显示在这里。', assignmentHint: '把左侧选择的动作直接关联到宠物行为。', selected: '已选择', play: '播放动作', assigned: '已关联行为', assign: '关联当前动作', search: '搜索', searchMotions: '搜索动作',
    motionMainOne: '主动作 1', motionMainTwo: '主动作 2', motionTouchHead: '触摸头部', motionAttention: '注意', motionError: '错误', motionDuration: '动作 · {value} 秒',
    expressionDefault: '默认', expressionSmile: '微笑', expressionSerious: '严肃', assignmentIdle: '待机', assignmentThinking: '思考中', assignmentWorking: '工作中', assignmentAttention: '注意', assignmentError: '错误',
    sourceTitle: '资源包', sourceBody: '在开始映射前检查模型兼容性以及包含的动作、表情和纹理。', sourceReady: '可以开始映射', sourceSummary: 'Cubism 4 · 5 个动作 · 3 个表情', sourceModel: '模型', sourceTextures: '纹理', sourceMotions: '动作', sourceExpressions: '表情', buildTitle: '包构建', buildBody: '检查目标配置并生成可安装的宠物包。', ready: '已就绪', buildTheme: '构建主题', buildPackage: '构建宠物包',
    general: '通用', runtimes: '运行时', targets: '目标与安装', storage: '存储', settingsTitle: '设置', settingsBody: '应用通用配置与每个 Live2Pet 项目保持分离。', appearance: '外观', language: '语言', system: '跟随系统', light: '浅色', dark: '深色', reopenLastProject: '启动时恢复上次项目',
    runtimeTitle: 'Live2D 运行时资源库', runtimeBody: '在本地保存，并根据 Cubism 版本自动选择。', runtimeAvailable: '可用', runtimeMissing: '未配置', generations: 'Cubism {value}',
    targetTitle: '安装位置', targetBody: '安装时再选择目标位置。普通构建和下载绝不会自动安装。', askEveryTime: '每次询问',
    storageTitle: '构建缓存', storageBody: '重复构建会复用已经捕获的帧，从而缩短等待时间。', cacheEmpty: '缓存为空', cacheEntries: '{count} 个缓存项目 · {size}', clearCache: '清除缓存',
    designPreview: '界面预览', notConnected: '桌面服务不可用', loading: '正在加载…', error: '出现问题', retry: '重试', confirmRemoveRuntimes: '确定移除所有已保存的 Live2D 运行时吗？', confirmClearCache: '确定清除全部构建缓存吗？',
    shellLabel: '桌面应用外壳预览', shellBody: '这个预览优先实现首次引导、完整设置页，以及更像 App 的 Source / Map / Build 工作区。',
    setupReview: '你依然可以先跳过 runtime 设置，先进行资源检查。等后面真正缺少 runtime 时，Live2Pet 应该把你直接带回对应的设置区，而不是让你再次手动判断版本。',
    recentPreview: '在外壳迁移阶段，最近项目先使用安全占位内容展示。',
    summaryOne: 'Welcome、首次引导、Settings 现在都是完整页面。',
    summaryTwo: 'runtime 和缓存管理已经移出那张很长的 mapper 文档。',
    summaryThree: 'Source、Map、Build 已经被拆成同一项目下的独立任务。',
    sourcePreviewTitle: '资源检查', sourcePreviewBody: '先确认兼容性、资源引用和模型结构，再进入映射。', mapPreviewTitle: '动作映射', mapPreviewBody: '使用规划中的左 / 中 / 右工作区，把动作关联到目标行为。', buildPreviewTitle: '构建与安装', buildPreviewBody: '把构建进度、生成预览、下载和安装收敛在一个目标页里。',
    bridgeTitle: '桥接状态', bridgeBody: '最终版本会逐步替换旧 mapper，而不是一次性重写整个工作流。',
    sampleMotionOne: '主待机循环', sampleMotionTwo: '工作姿态', sampleMotionThree: '触摸反应',
    sampleExpressionOne: '基础表情', sampleExpressionTwo: '微笑', sampleExpressionThree: '严肃',
    chosenMotion: '当前动作', chosenExpression: '当前表情', assignmentEmpty: '还没有关联行为',
    targetAssignments: '计划中的目标行为', targetIdle: '待机', targetWork: '工作中', targetTouch: '触摸反应',
    buildSummary: '构建概览', buildSummaryBody: '这一版外壳先把生成包流程做得更像应用。下一步就是把这些面板真正接到现有 mapper 和 build service 上。',
    cacheRefresh: '刷新缓存状态',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  let value: string = messages[locale][key];
  for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
  return value;
}
