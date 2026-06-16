import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { ProjectList } from '../components/Studio/ProjectList'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { createProject, deleteProject, renameProject, selectProjectList } from '../store/studioSlice'

export function StudioProjects() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const projects = useAppSelector(selectProjectList)
  // Mount-time clock for "edited X ago" — reading Date.now() in render is impure
  // (react-hooks/purity); a state initializer runs once and keeps render pure.
  const [now] = useState(() => Date.now())

  const onNew = () => {
    const id = crypto.randomUUID()
    dispatch(createProject({ id, now: Date.now() }))
    navigate(`/studio/project/${id}`)
  }
  const onOpen = (id: string) => navigate(`/studio/project/${id}`)
  const onRename = (id: string, name: string) => dispatch(renameProject({ id, name, now: Date.now() }))
  const onDelete = (id: string) => dispatch(deleteProject(id))

  return (
    <>
      <PageHero
        eyebrow="EP 09 — Studio · scene producer"
        title={<>Your projects<Dot /></>}
        lead="Each recording you turn into a short video is its own project. Pick up where you left off, or start a new one."
      />
      <Section eyebrow="— Producer" title={<>Projects<Dot /></>} divider={false}>
        <ProjectList
          projects={projects}
          now={now}
          onNew={onNew}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
        />
      </Section>
    </>
  )
}
