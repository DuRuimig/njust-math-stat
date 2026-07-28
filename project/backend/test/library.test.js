const library = require('../../../miniprogram/utils/library');
const courseLibrary = require('../../../miniprogram/data/course-library');

describe('课程任课历史与最新教材', () => {
  it('保留往期教师并使用 2026 秋最新教材', () => {
    const course = library.getCourses().find((item) => item.codeValues.includes('71100201'));

    expect(course).toBeTruthy();
    expect(course.textbookLabel).toBe('高等代数（第六版） · 高等教育出版社');
    expect(library.getTeacherOfferingGroupsForCourse(course).map((item) => ({
      teacher: item.teacher,
      terms: item.sourceTermsLabel,
    }))).toEqual(expect.arrayContaining([
      { teacher: '吕新民', terms: '2025年秋' },
      { teacher: '冯敏', terms: '2026年秋' },
    ]));
  });

  it('课程级记录不伪造专业归属且同一教师学期不重复', () => {
    const records = courseLibrary.teachingHistory || [];
    const identities = records.flatMap((record) => (record.teachers || []).map((teacher) => [
      record.courseCode,
      teacher,
      record.sourceTerm,
    ].join('|')));

    expect(records).toHaveLength(20);
    expect(new Set(identities).size).toBe(identities.length);
    expect(records.every((record) => record.scope === 'course' && !record.major)).toBe(true);
    expect(library.getTeacherByName('李超')).toMatchObject({
      name: '李超',
      department: '数学系',
      title: '未收录',
      advisorQualifications: '博士生导师',
    });
  });

  it('保留官网明确职称，导师资格缺少时显示未标明', () => {
    expect(library.getTeacherByName('范金华')).toMatchObject({
      department: '数学系',
      title: '教授',
      advisorQualifications: '博士生导师',
    });
    expect(library.getTeacherByName('冯敏')).toMatchObject({
      title: '未收录',
      advisorQualifications: '未标明',
    });
  });

  it('教师目录可按点赞数降序排列，并稳定处理缺失点赞数', () => {
    const teachers = library.sortTeachersByLikeCount([
      { name: 'Charlie', likeCount: 0 },
      { name: 'Alice', likeCount: 8 },
      { name: 'Bob' },
      { name: 'Dora', likeCount: 8 },
    ]);

    expect(teachers.map((teacher) => teacher.name)).toEqual(['Alice', 'Dora', 'Bob', 'Charlie']);
  });

  it('包含官网名录教师，并保留当前官网未列出的历史任课教师', () => {
    const teachers = library.getTeachers();

    expect(teachers).toHaveLength(95);
    expect(library.getTeacherByName('安红利')).toMatchObject({
      department: '数学系',
      title: '教授',
      advisorQualifications: '博士生导师',
    });
    expect(library.getTeacherByName('张霞')).toMatchObject({
      department: '大学数学基础教学中心',
      title: '未收录',
      advisorQualifications: '未标明',
    });
    expect(library.getTeacherByName('丁利')).toMatchObject({
      department: '未收录',
    });
  });
});
