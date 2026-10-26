import { Redirect, useLocalSearchParams } from 'expo-router'

import { homeCategorySlugSchema } from '@projo/shared/api/home'

import { CategoryScreen } from '../../../../features/catalog/ListScreens.tsx'

const Category = () => {
  const slug = homeCategorySlugSchema.safeParse(useLocalSearchParams().category)
  return slug.success ? <CategoryScreen category={slug.data} /> : <Redirect href="/" />
}

export default Category
