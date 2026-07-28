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
      department: '未收录',
      title: '未收录',
    });
  });
});
