/**
 * The closed icon and panel-tint vocabularies for category groups and
 * sub-categories — the console can only ever pick one of these, because the
 * app side (`CategoryRepository.iconsByName` / `tintsByName` in
 * `lib/data/neon/category_repository.dart`) resolves the string to a fixed
 * Flutter `IconData` / `Color` and cannot render an arbitrary name. **Keep the
 * `value` on every entry here identical to the Dart map's keys.**
 */
export const CATEGORY_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: 'spa_outlined', label: 'Spa' },
  { value: 'monitor_heart_outlined', label: 'Heart monitor' },
  { value: 'medication_outlined', label: 'Medication' },
  { value: 'bloodtype_outlined', label: 'Blood drop' },
  { value: 'medical_services_outlined', label: 'Medical bag' },
  { value: 'biotech_outlined', label: 'Lab / biotech' },
  { value: 'face_retouching_natural_outlined', label: 'Skin care' },
  { value: 'content_cut_rounded', label: 'Scissors (hair)' },
  { value: 'clean_hands_outlined', label: 'Clean hands (oral)' },
  { value: 'shower_outlined', label: 'Shower (bath & body)' },
  { value: 'face_outlined', label: 'Face (grooming)' },
  { value: 'favorite_outline_rounded', label: 'Heart outline' },
  { value: 'accessibility_new_rounded', label: 'Bone & joint' },
  { value: 'local_dining_outlined', label: 'Dining (digestive)' },
  { value: 'remove_red_eye_outlined', label: 'Eye' },
  { value: 'healing_outlined', label: 'Healing / pain relief' },
  { value: 'smoke_free_rounded', label: 'Smoke-free' },
  { value: 'water_drop_outlined', label: 'Water drop (liver)' },
  { value: 'medication_liquid_outlined', label: 'Liquid medication' },
  { value: 'wb_sunny_outlined', label: 'Sun (vitamin D)' },
  { value: 'fitness_center_rounded', label: 'Fitness (protein)' },
  { value: 'set_meal_outlined', label: 'Fish meal (omega-3)' },
  { value: 'emoji_food_beverage_outlined', label: 'Beverage (calcium)' },
  { value: 'shield_outlined', label: 'Shield (immunity)' },
  { value: 'speed_rounded', label: 'Speedometer (glucometer)' },
  { value: 'receipt_long_outlined', label: 'Receipt (test strips)' },
  { value: 'coffee_outlined', label: 'Coffee (sugar substitute)' },
  { value: 'rice_bowl_outlined', label: 'Rice bowl (diabetic food)' },
  { value: 'airline_seat_legroom_normal_rounded', label: 'Leg room (foot care)' },
  { value: 'vaccines_outlined', label: 'Vaccine / syringe' },
  { value: 'masks_outlined', label: 'Mask' },
  { value: 'airline_seat_recline_normal_rounded', label: 'Mobility aid' },
  { value: 'fact_check_outlined', label: 'Checklist' },
  { value: 'science_outlined', label: 'Science / test tube' },
];

export const CATEGORY_TINT_OPTIONS: { value: string; label: string; hex: string }[] = [
  { value: 'panelGreen', label: 'Green', hex: '#E8F1EC' },
  { value: 'panelCream', label: 'Cream', hex: '#FDF3E3' },
  { value: 'panelBlue', label: 'Blue', hex: '#EAF3FC' },
  { value: 'panelPink', label: 'Pink', hex: '#FBECEC' },
  { value: 'panelSlate', label: 'Slate', hex: '#EDEFF4' },
  { value: 'pageTint', label: 'Page tint', hex: '#EFF4FC' },
];
