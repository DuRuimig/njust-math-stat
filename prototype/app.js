(() => {
  const library = window.COURSE_LIBRARY;
  const app = document.querySelector('.phone');
  if (!library || !app) return;

  const normalizeCourseName = (name) => String(name || '').replace(/[\u3000\s]+/g, '').replace(/[（）]/g, (character) => character === '（' ? '(' : ')').toLowerCase();
  const courseId = (course) => `course::${encodeURIComponent(normalizeCourseName(course.name))}`;
  const displayMajorFor = (course) => Number(course.semester) >= 1 && Number(course.semester) <= 4 ? '数学类' : course.major;
  const groupedCourses = [...new Map(library.courses.map((course) => [normalizeCourseName(course.name), course])).values()].map((course) => {
    const variants = library.courses.filter((item) => normalizeCourseName(item.name) === normalizeCourseName(course.name));
    const majors = [...new Set(variants.map((item) => item.major))];
    const displayMajors = [...new Set(variants.map(displayMajorFor))];
    const codes = [...new Set(variants.map((item) => item.code))];
    const requirements = [...new Set(variants.map((item) => item.requirement ?? '待补充'))];
    const credits = [...new Set(variants.map((item) => item.credits ?? '待补充'))];
    const hours = [...new Set(variants.map((item) => item.hours ?? '待补充'))];
    const categories = [...new Set(variants.map((item) => item.category ?? '待补充'))];
    const semesters = [...new Set(variants.map((item) => item.semester ?? '待补充'))];
    const semesterLabels = [...new Set(variants.map((item) => item.stage || (item.semester == null ? '建议学期待补充' : `第${item.semester}学期`)))];
    const seasons = [...new Set(variants.map((item) => item.season ?? '待补充'))];
    const label = (values, suffix = '') => `${values.join(' / ')}${suffix}`;
    return {
      key: courseId(course),
      name: course.name,
      variants,
      majors,
      displayMajors,
      majorLabel: displayMajors.join('、'),
      codes,
      codeLabel: label(codes),
      requirementLabel: label(requirements),
      creditsLabel: label(credits),
      hoursLabel: label(hours),
      categoryLabel: label(categories),
      categoryValues: categories,
      semesterValues: semesters,
      semesterLabelDisplay: label(semesterLabels),
      semesterDisplay: label(semesterLabels),
      seasonValues: seasons,
      seasonLabel: label(seasons),
      recommendedTermLabel: seasons.map((season) => season === '待补充' ? '建议季节待补充' : `建议${season}季`).join('、')
    };
  });
  const courseById = new Map(groupedCourses.map((course) => [courseId(course), course]));
  const teacherByName = new Map((library.teachers || []).map((teacher) => [teacher.name, teacher]));
  let currentCourseId = courseId(groupedCourses[0]);
  let submissions = [];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const currentCourse = () => courseById.get(currentCourseId) || groupedCourses[0];
  const offeringsFor = (course) => library.offerings.filter((offering) => course.variants.some((variant) => variant.major === offering.major && variant.code === offering.courseCode));
  const displayMajorForOffering = (course, offering) => displayMajorFor(course.variants.find((variant) => variant.major === offering.major && variant.code === offering.courseCode) || { major: offering.major });
  const teacherNamesFor = (teacher) => String(teacher || '').split(/[、,，/／]/).map((name) => name.trim()).filter(Boolean);
  const valuesFor = (records, field, fallback = '待补充') => [...new Set(records.map((record) => record[field]).filter((value) => value != null && value !== '' && value !== '-' && value !== '无'))].join('、') || fallback;
  const groupedOfferingsFor = (course) => {
    const groups = new Map();
    offeringsFor(course).forEach((offering) => {
      teacherNamesFor(offering.teacher).forEach((teacher) => {
        if (!groups.has(teacher)) groups.set(teacher, { teacher, records: [] });
        groups.get(teacher).records.push(offering);
      });
    });
    return [...groups.values()].map((group) => ({
      ...group,
      displayMajors: [...new Set(group.records.map((record) => displayMajorForOffering(course, record)))],
      originalMajors: [...new Set(group.records.map((record) => record.major || '待补充'))],
      courseCodes: [...new Set(group.records.map((record) => record.courseCode || '待补充'))],
      terms: valuesFor(group.records, 'term'),
      textbooks: valuesFor(group.records, 'textbook'),
      offeringUnits: valuesFor(group.records, 'offeringUnit'),
      sourceTerms: valuesFor(group.records, 'sourceTerm'),
      matchMethods: [...new Set(group.records.map((record) => record.matchMethod))]
    }));
  };
  const courseOptions = (selectedId) => groupedCourses.map((course) => `<option value="${escapeHtml(courseId(course))}"${courseId(course) === selectedId ? ' selected' : ''}>${escapeHtml(course.name)}${course.majors.length > 1 ? ` · ${escapeHtml(course.majorLabel)}` : ''}</option>`).join('');
  const advisorLabel = (qualification) => {
    if (qualification === '博士生导师' || qualification === '硕士生导师') return `0701 数学：${qualification}`;
    return '0701 数学目录未列出（不作资格否定）';
  };
  const teacherDirectoryBlock = (offering) => {
    const teacher = teacherByName.get(offering.teacher);
    if (teacher) {
      const academy = teacher.department ? `学院师资名录：${escapeHtml(teacher.department)}` : '学院师资名录：当前名录未列出';
      const directoryLink = teacher.academyDirectoryLink ? `<p><a class="source-link" href="${escapeHtml(teacher.academyDirectoryLink)}" target="_blank" rel="noreferrer">查看学院公开目录</a></p>` : '';
      return `<p>${academy}</p><p>导师资格目录：${escapeHtml(advisorLabel(teacher.graduateAdvisor0701))}</p>${directoryLink}`;
    }
    return offering.offeringUnit === '数学与统计学院'
      ? '<p>学院师资名录：当前名录未列出</p>'
      : '<p>学院师资名录：非数统学院开课单位，本轮未作院系归属匹配</p>';
  };

  app.innerHTML = `
    <section class="view active" id="home">
      <span class="eyebrow">NJUST · MATH &amp; STATISTICS</span><h1>数统课程资料库</h1><p class="sub">培养方案课程定义与当前固定的春秋开课安排。</p>
      <label class="search"><span class="icon">⌕</span><input id="course-search" placeholder="搜索课程名称或课程代码" /></label>
      <div class="toolbar"><select class="select" id="major-filter"><option value="">全部专业</option>${[...new Set(groupedCourses.flatMap((course) => course.displayMajors))].map((major) => `<option>${escapeHtml(major)}</option>`).join('')}</select><select class="select" id="semester-filter"><option value="">全部学期</option>${[1,2,3,4,5,6,7,8].map((semester) => `<option value="${semester}">第 ${semester} 学期</option>`).join('')}</select></div>
      <div class="quick"><button data-go="teacher"><span>◉</span>教师教材</button><button data-go="materials"><span>▦</span>课程资料</button><button data-go="ask"><span>✦</span>AI 问答</button></div>
      <div class="section-title"><h2>课程目录</h2><span class="course-count" id="course-count"></span></div><div class="course-grid" id="course-list"></div>
       <p class="data-note">课程定义共 ${groupedCourses.length} 门聚合课程，仅含秋春常规课程。总学时已按 ${escapeHtml(library.meta.hoursSource)} 核验；教师与教材按已确认的春秋安排展示。</p>
    </section>

    <section class="view" id="detail"><div class="topline"><button class="back" data-go="home">‹</button><strong>课程详情</strong></div><div class="detail-head"><span class="eyebrow" id="detail-major"></span><h1 id="detail-title"></h1><p class="sub" id="detail-code"></p><div class="detail-list" id="detail-fields"></div><div class="action-row"><button class="secondary" data-go="teacher">教师与教材</button><button class="primary" data-go="materials">查看课程资料</button></div></div><div class="section-title"><h2>开课安排</h2><span class="course-count" id="offering-count"></span></div><div id="offering-list"></div><p class="data-note">开课安排来自 ${escapeHtml(library.meta.offeringSource)}；当前按每年春季、秋季展示，并保留来源学期以便追溯。教务排课查询可用于后续逐条核验，未把单条查询结果泛化为全量记录。</p></section>

    <section class="view" id="materials"><div class="topline"><button class="back" data-go="detail">‹</button><strong>课程资料</strong></div><span class="eyebrow">授权资料库</span><h1 id="materials-title"></h1><p class="sub">当前尚未接入真实资料，也没有展示任何 mock 试卷、课件或下载量。</p><div class="form-card" style="margin-top:18px"><p class="empty">待收录已获授权且审核通过的课程资料。投稿入口仅演示校验流程，不会上传文件或对外发布内容。</p><button class="secondary" data-go="upload">投稿资料（演示）</button></div></section>

    <section class="view" id="upload"><div class="topline"><button class="back" data-go="detail">‹</button><strong>投稿资料</strong></div><span class="eyebrow">本地交互演示</span><h1>提交学习资料</h1><p class="sub">本原型不上传文件、不接数据库，提交结果仅在当前页面会话展示。</p><form class="form-card" id="upload-form" style="margin-top:18px"><div class="field"><label for="upload-course">课程</label><select id="upload-course" required></select></div><div class="field"><label for="upload-teacher">关联教师</label><select id="upload-teacher"><option value="">未选择 / 待补充</option></select></div><div class="filters"><div class="field"><label for="upload-term">开课季</label><select id="upload-term" required><option value="">请选择</option><option>每年秋季</option><option>每年春季</option></select></div><div class="field"><label for="upload-type">资料类型</label><select id="upload-type" required><option value="">请选择</option><option>课堂课件</option><option>复习笔记</option><option>本人原创资料</option></select></div></div><div class="field"><label>资料文件</label><div class="file-field"><label class="file-pick" for="upload-file"><span>选择文件</span><span>＋</span></label><input id="upload-file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.zip" required><p class="file-name" id="file-name">文件仅用于本地表单演示</p></div></div><div class="field"><label for="upload-source">来源说明</label><textarea id="upload-source" required placeholder="说明已获得传播授权的依据"></textarea></div><label class="consent"><input id="upload-consent" type="checkbox" required><span>我确认资料具备传播授权，且不含个人隐私或考试保密内容。</span></label><button class="primary" type="submit">模拟提交审核</button><p class="form-status" id="upload-status" role="status"></p></form></section>

    <section class="view" id="ask"><div class="topline"><span class="eyebrow">AI INTERACTION PROTOTYPE</span></div><h1>选课问问 AI</h1><p class="sub">仅演示提问界面，未连接模型、RAG 或真实课程评价。</p><div class="chat" id="chat" style="margin-top:26px"><div class="bubble ai">当前可查询的静态范围包括课程名称、代码、学分、学期、分类，以及已录入的教师教材记录。</div></div><div class="askbox"><input id="ask-input" placeholder="输入课程问题" /><button class="send" id="send">发送</button></div></section>

    <section class="view" id="teacher"><div class="topline"><button class="back" data-go="detail">‹</button><strong>教师与教材</strong></div><span class="eyebrow">开课安排与公开目录</span><h1 id="teacher-course-title"></h1><p class="sub">开课记录、学院公开师资目录与研究生导师资格分开显示；不展示课程评价、职称或未经核验的个人信息。</p><div class="field" style="margin-top:18px"><label for="teacher-course">切换课程</label><select id="teacher-course"></select></div><div id="teacher-offering-list"></div><p class="data-note">学院公开师资名录：<a class="source-link" href="${library.meta.staffDirectory}" target="_blank" rel="noreferrer">南京理工大学数学与统计学院师资名录</a>；研究生导师目录：<a class="source-link" href="${library.meta.graduateTutorDirectory}" target="_blank" rel="noreferrer">0701 数学导师名录</a>。导师资格不等同于本科任课安排。</p></section>

    <section class="view" id="profile"><div class="profile"><div class="avatar">未</div><h2>未接入登录</h2><p>微信登录、账号与个人资料均未接入。</p></div><div class="menu"><button data-go="upload"><span>投稿资料（演示）</span><span>›</span></button><button data-go="materials"><span>我的收藏</span><span>未接入</span></button><button data-go="ask"><span>AI 问答</span><span>原型</span></button></div><div class="section-title"><h2>本地投稿记录</h2></div><div id="submission-list"><p class="sub">当前会话还没有模拟投稿。</p></div></section>
    <nav class="nav"><button class="active" data-go="home"><span>⌂</span>课程</button><button data-go="teacher"><span>◉</span>教师教材</button><button data-go="profile"><span>▦</span>我的</button></nav>
  `;

  const showToast = (message) => {
    let toast = document.getElementById('toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; document.body.append(toast); }
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  };

  const renderHome = () => {
    const keyword = document.getElementById('course-search').value.trim().toLowerCase();
    const major = document.getElementById('major-filter').value;
    const semester = document.getElementById('semester-filter').value;
      const visible = groupedCourses.filter((course) => (!major || course.displayMajors.includes(major)) && (!semester || course.semesterValues.some((value) => String(value) === semester)) && (!keyword || `${course.name}${course.codes.join('')}${course.majors.join('')}`.toLowerCase().includes(keyword)));
    document.getElementById('course-count').textContent = `${visible.length} 门课程`;
     document.getElementById('course-list').innerHTML = visible.map((course) => `<button class="card course-card" data-course-id="${escapeHtml(courseId(course))}"><div class="row"><div><div class="course-name">${escapeHtml(course.name)}</div><div class="meta">${escapeHtml(course.majorLabel)} · ${escapeHtml(course.codeLabel)}</div></div><span class="tag">${escapeHtml(course.creditsLabel)} 学分</span></div><div class="tags"><span class="tag good">${escapeHtml(course.requirementLabel)}</span><span class="tag">${escapeHtml(course.categoryLabel)}</span><span class="tag">${escapeHtml(course.semesterLabelDisplay)} · ${escapeHtml(course.seasonLabel)}</span></div></button>`).join('') || '<p class="empty">没有匹配的课程。</p>';
  };

  const renderOfferings = (targetId, course) => {
    const offerings = groupedOfferingsFor(course);
    const target = document.getElementById(targetId);
     target.innerHTML = offerings.map((offering) => `<article class="card offering"><div class="row"><h3>${escapeHtml(offering.teacher)}</h3><span class="status ${offering.matchMethods.every((method) => method === '课程号') ? 'approved' : 'pending'}">${escapeHtml(offering.matchMethods.join('、'))}匹配</span></div><p>覆盖专业：${escapeHtml(offering.displayMajors.join('、'))} · 课程代码：${escapeHtml(offering.courseCodes.join('、'))}</p><p>开课季：${escapeHtml(offering.terms)} · 开课单位：${escapeHtml(offering.offeringUnits)}</p><p>教材：${escapeHtml(offering.textbooks)}</p><p>来源学期：${escapeHtml(offering.sourceTerms)} · 关联记录：${offering.records.length} 条</p><p>原始专业：${escapeHtml(offering.originalMajors.join('、'))} · 原始课程代码：${escapeHtml(offering.courseCodes.join('、'))}</p>${teacherDirectoryBlock(offering)}</article>`).join('') || '<p class="empty">该课程在当前教材匹配材料中没有开课记录。</p>';
    return offerings;
  };

  const renderDetail = () => {
    const course = currentCourse();
     document.getElementById('detail-major').textContent = `${course.majorLabel} · ${course.categoryLabel}`;
    document.getElementById('detail-title').textContent = course.name;
     document.getElementById('detail-code').textContent = `课程代码：${course.codeLabel}`;
     document.getElementById('detail-fields').innerHTML = [['修读性质', course.requirementLabel], ['学分', `${course.creditsLabel} 学分`], ['建议修读', course.semesterLabelDisplay], ['开课季', course.seasonLabel], ['总学时', `${course.hoursLabel} 学时`]].map(([label, value]) => `<div>${escapeHtml(label)}<b>${escapeHtml(value)}</b></div>`).join('');
    const offerings = renderOfferings('offering-list', course);
    document.getElementById('offering-count').textContent = `${offerings.length} 条记录`;
    document.getElementById('materials-title').textContent = course.name;
  };

  const renderTeacherPage = () => {
    const course = currentCourse();
    document.getElementById('teacher-course-title').textContent = course.name;
    const select = document.getElementById('teacher-course');
    select.innerHTML = courseOptions(currentCourseId);
    renderOfferings('teacher-offering-list', course);
  };

  const refreshUploadFields = () => {
    const course = currentCourse();
    const courseSelect = document.getElementById('upload-course');
    courseSelect.innerHTML = courseOptions(currentCourseId);
    const teachers = groupedOfferingsFor(course).map((offering) => offering.teacher);
    document.getElementById('upload-teacher').innerHTML = '<option value="">未选择 / 待补充</option>' + teachers.map((teacher) => `<option>${escapeHtml(teacher)}</option>`).join('');
  };

  const renderSubmissions = () => {
    const list = document.getElementById('submission-list');
    list.innerHTML = submissions.length ? submissions.map((item) => `<article class="card"><div class="course-name">${escapeHtml(item.title)}</div><div class="meta">${escapeHtml(item.course)} · ${escapeHtml(item.term)} · ${escapeHtml(item.type)}</div><div class="tags"><span class="tag warm">仅本地演示，未上传</span></div></article>`).join('') : '<p class="sub">当前会话还没有模拟投稿。</p>';
  };

  const go = (id) => {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === id));
    document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.go === id));
    if (id === 'detail' || id === 'materials' || id === 'upload') renderDetail();
    if (id === 'teacher') renderTeacherPage();
    if (id === 'upload') refreshUploadFields();
    if (id === 'profile') renderSubmissions();
    window.scrollTo(0, 0);
  };

  app.addEventListener('click', (event) => {
    const courseButton = event.target.closest('[data-course-id]');
    if (courseButton) { currentCourseId = courseButton.dataset.courseId; go('detail'); return; }
    const navigation = event.target.closest('[data-go]');
    if (navigation) go(navigation.dataset.go);
  });
  document.getElementById('course-search').addEventListener('input', renderHome);
  document.getElementById('major-filter').addEventListener('change', renderHome);
  document.getElementById('semester-filter').addEventListener('change', renderHome);
  document.getElementById('teacher-course').addEventListener('change', (event) => { currentCourseId = event.target.value; renderDetail(); renderTeacherPage(); });
  document.getElementById('upload-course').addEventListener('change', (event) => { currentCourseId = event.target.value; renderDetail(); refreshUploadFields(); });
  document.getElementById('upload-file').addEventListener('change', (event) => { document.getElementById('file-name').textContent = event.target.files[0]?.name || '文件仅用于本地表单演示'; });
  document.getElementById('upload-form').addEventListener('submit', (event) => { event.preventDefault(); if (!event.currentTarget.checkValidity()) return event.currentTarget.reportValidity(); const course = currentCourse(); submissions.unshift({ title: document.getElementById('upload-file').files[0].name, course: course.name, term: document.getElementById('upload-term').value, type: document.getElementById('upload-type').value }); document.getElementById('upload-status').textContent = '已记录本地演示投稿，未上传文件。'; event.currentTarget.reset(); document.getElementById('file-name').textContent = '文件仅用于本地表单演示'; showToast('已完成本地演示提交'); });
  document.getElementById('send').addEventListener('click', () => { const input = document.getElementById('ask-input'); if (!input.value.trim()) return; const chat = document.getElementById('chat'); chat.insertAdjacentHTML('beforeend', `<div class="bubble me">${escapeHtml(input.value)}</div><div class="bubble ai">这是静态原型，暂未连接模型或检索系统。请在课程目录中查看已收录的结构化字段。<span class="source">来源范围：${escapeHtml(library.meta.courseDefinitionSource)}、${escapeHtml(library.meta.offeringSource)}</span></div>`); input.value = ''; });

  renderHome();
  renderDetail();
  refreshUploadFields();
})();
