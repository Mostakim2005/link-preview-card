export function voidAsync<Args extends unknown[]>(
	fn: (...args: Args) => Promise<void>,
): (...args: Args) => void {
	return (...args: Args) => {
		void fn(...args);
	};
}
