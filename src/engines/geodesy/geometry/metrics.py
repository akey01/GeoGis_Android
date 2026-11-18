import sys
import json
from shapely.geometry import Polygon

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({'status': 'error', 'message': 'No input data provided'}))
            sys.exit(1)
        payload = json.loads(input_data)
        points = payload.get('points', [])
        
        if len(points) < 3:
            print(json.dumps({'status': 'error', 'message': 'A polygon requires at least 3 points.'}))
            sys.exit(1)
            
        coords = [(pt['x'], pt['y']) for pt in points]
        poly = Polygon(coords)
        
        metrics = {
            'area': poly.area,
            'perimeter': poly.length,
            'centroid': {'x': poly.centroid.x, 'y': poly.centroid.y},
            'bounds': poly.bounds # (minx, miny, maxx, maxy)
        }
        
        print(json.dumps({'status': 'success', 'metrics': metrics}))
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
