import { useAppStore } from '../store/useAppStore';
import { Card } from './ui';

export function CourseList() {
  const courses = useAppStore((state) => state.courses);
  const handouts = useAppStore((state) => state.handouts);
  const selected = useAppStore((state) => state.selectedCourse);
  const selectCourse = useAppStore((state) => state.selectCourse);

  if (courses.length === 0) return null;

  return (
    <Card
      id="courses"
      title="Courses"
      description="Select a course to filter the handout table below."
    >
      <ul className="divide-y divide-edge" role="list">
        {courses.map((course) => {
          const complete = course.handoutIds.filter(
            (id) => handouts[id]?.status === 'completed',
          ).length;
          const isActive = selected === course.code;
          return (
            <li key={course.code}>
              <button
                type="button"
                onClick={() => selectCourse(course.code)}
                aria-pressed={isActive}
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left text-sm transition-colors ${
                  isActive ? 'bg-brand-soft text-brand' : 'hover:bg-surface'
                }`}
              >
                <span className="font-semibold">{course.code}</span>
                <span className="tabular-nums text-muted">
                  {course.handoutIds.length} handouts · {complete} complete
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
